import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { guardSql } from "./guard";
import { chat, type ModelConfig } from "./ollama";
import {
  answerSystemPrompt,
  answerUserPrompt,
  MAX_ROWS,
  parseSqlDraft,
  sqlSystemPrompt,
  type CellValue,
  type ResultTable,
} from "./prompt";

const STATEMENT_TIMEOUT_MS = 8_000;

export interface AskResult {
  answer: string;
  note: string;
  sql: string;
  table: ResultTable | null;
}

// Every table name the model may use is shadowed by a CTE filtered to this
// user, so a query can only ever see that person's rows.
function scopedPrefix(userId: string) {
  return sql`WITH
  providers AS (SELECT id, name, kind, website, notes FROM public.providers WHERE user_id = ${userId}),
  orders AS (SELECT id, provider_id, merchant, reference, channel, purchased_at, total_amount_cents, currency, instalment_count, status, notes FROM public.orders WHERE user_id = ${userId}),
  instalments AS (SELECT i.id, i.order_id, i.sequence, i.due_on, i.principal_cents, i.paid_cents, i.pending_cents, i.waived_cents FROM public.instalments i JOIN public.orders o ON o.id = i.order_id WHERE o.user_id = ${userId}),
  fees AS (SELECT f.id, f.instalment_id, f.kind, f.amount_cents, f.incurred_on, f.note FROM public.fees f JOIN public.instalments i ON i.id = f.instalment_id JOIN public.orders o ON o.id = i.order_id WHERE o.user_id = ${userId}),
  payments AS (SELECT p.id, p.instalment_id, p.amount_cents, p.paid_on, p.method, p.reference FROM public.payments p JOIN public.instalments i ON i.id = p.instalment_id JOIN public.orders o ON o.id = i.order_id WHERE o.user_id = ${userId}),
  refunds AS (SELECT r.id, r.order_id, r.amount_cents, r.refunded_on, r.note FROM public.refunds r JOIN public.orders o ON o.id = r.order_id WHERE o.user_id = ${userId})`;
}

function toCell(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return /^-?\d+$/.test(value) && value.length < 16 ? Number(value) : value;
  return JSON.stringify(value);
}

export async function runScopedQuery(db: Db, userId: string, rawSql: string): Promise<ResultTable> {
  const body = guardSql(rawSql);
  const query = sql`${scopedPrefix(userId)} SELECT * FROM (${sql.raw(body)}) AS q LIMIT ${sql.raw(String(MAX_ROWS + 1))}`;

  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    await tx.execute(sql.raw(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`));
    return tx.execute(query);
  });

  const list = rows as unknown as Record<string, unknown>[];
  const columns = list.length > 0 ? Object.keys(list[0]!) : [];
  return {
    columns,
    rows: list.slice(0, MAX_ROWS).map((row) => columns.map((c) => toCell(row[c]))),
    truncated: list.length > MAX_ROWS,
  };
}

export async function ask(
  db: Db,
  config: Required<ModelConfig>,
  userId: string,
  question: string,
  today: string,
  currency: string,
): Promise<AskResult> {
  const draftText = await chat(
    config.url,
    config.model,
    [
      { role: "system", content: sqlSystemPrompt(today, currency) },
      { role: "user", content: question },
    ],
    { json: true },
  );
  const draft = parseSqlDraft(draftText);
  if (!draft.sql.trim()) {
    return { answer: draft.note || "I can't answer that from your orders.", note: "", sql: "", table: null };
  }

  const table = await runScopedQuery(db, userId, draft.sql);
  const answer = await chat(config.url, config.model, [
    { role: "system", content: answerSystemPrompt(currency) },
    { role: "user", content: answerUserPrompt(question, table) },
  ]);
  return { answer: answer.trim(), note: draft.note, sql: draft.sql.trim(), table };
}
