import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { guardSql } from "./guard";
import { chat, type ChatMessage, type ModelConfig } from "./ollama";
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
const REPAIR_ROUNDS = 2;

export interface AskResult {
  answer: string;
  note: string;
  sql: string;
  table: ResultTable | null;
}

// Every table name the model may use is shadowed by a CTE filtered to this
// user, so a query can only ever see that person's rows. The two *_balances
// CTEs precompute the ledger maths the model otherwise gets wrong.
function scopedPrefix(userId: string, today: string) {
  return sql`WITH
  providers AS (SELECT id, name, kind, website, notes FROM public.providers WHERE user_id = ${userId}),
  orders AS (SELECT id, provider_id, merchant, reference, channel, purchased_at, total_amount_cents, currency, instalment_count, status, notes FROM public.orders WHERE user_id = ${userId}),
  instalments AS (SELECT i.id, i.order_id, i.sequence, i.due_on, i.principal_cents, i.paid_cents, i.pending_cents, i.waived_cents FROM public.instalments i JOIN public.orders o ON o.id = i.order_id WHERE o.user_id = ${userId}),
  fees AS (SELECT f.id, f.instalment_id, f.kind, f.amount_cents, f.incurred_on, f.note FROM public.fees f JOIN public.instalments i ON i.id = f.instalment_id JOIN public.orders o ON o.id = i.order_id WHERE o.user_id = ${userId}),
  payments AS (SELECT p.id, p.instalment_id, p.amount_cents, p.paid_on, p.method, p.reference FROM public.payments p JOIN public.instalments i ON i.id = p.instalment_id JOIN public.orders o ON o.id = i.order_id WHERE o.user_id = ${userId}),
  refunds AS (SELECT r.id, r.order_id, r.amount_cents, r.refunded_on, r.note FROM public.refunds r JOIN public.orders o ON o.id = r.order_id WHERE o.user_id = ${userId}),
  instalment_balances AS (
    SELECT i.id AS instalment_id, i.order_id, i.sequence, i.due_on, i.principal_cents,
      COALESCE(f.fees_cents, 0) AS fees_cents, i.paid_cents, i.pending_cents, i.waived_cents,
      GREATEST(0, i.principal_cents + COALESCE(f.fees_cents, 0) - i.paid_cents - i.waived_cents) AS owed_cents,
      (i.principal_cents + COALESCE(f.fees_cents, 0) - i.paid_cents - i.waived_cents) <= 0 AS is_paid,
      ((i.principal_cents + COALESCE(f.fees_cents, 0) - i.paid_cents - i.waived_cents) > 0 AND i.due_on < ${today}::date) AS is_overdue
    FROM instalments i
    LEFT JOIN (SELECT instalment_id, SUM(amount_cents) AS fees_cents FROM fees GROUP BY instalment_id) f ON f.instalment_id = i.id
  ),
  order_balances AS (
    SELECT o.id AS order_id, o.merchant, o.provider_id, o.purchased_at, o.total_amount_cents, o.instalment_count, o.status,
      SUM(b.owed_cents)::bigint AS owed_cents, SUM(b.paid_cents)::bigint AS paid_cents, SUM(b.fees_cents)::bigint AS fees_cents,
      COUNT(*) FILTER (WHERE NOT b.is_paid) AS remaining_count, COUNT(*) FILTER (WHERE b.is_paid) AS paid_count,
      MIN(b.due_on) FILTER (WHERE NOT b.is_paid) AS next_due_on
    FROM orders o JOIN instalment_balances b ON b.order_id = o.id
    GROUP BY o.id, o.merchant, o.provider_id, o.purchased_at, o.total_amount_cents, o.instalment_count, o.status
  )`;
}

function toCell(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") {
    if (/^-?\d+$/.test(value) && value.length < 16) return Number(value);
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(value)) return value.slice(0, 10);
    return value;
  }
  return JSON.stringify(value);
}

export async function runScopedQuery(db: Db, userId: string, rawSql: string, today: string): Promise<ResultTable> {
  const body = guardSql(rawSql);
  const query = sql`${scopedPrefix(userId, today)} SELECT * FROM (${sql.raw(body)}) AS q LIMIT ${sql.raw(String(MAX_ROWS + 1))}`;

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

  const conversation = [
    { role: "system", content: sqlSystemPrompt(today, currency) },
    { role: "user", content: question },
  ] as ChatMessage[];
  let finalSql = draft.sql;
  let note = draft.note;
  let table: ResultTable | null = null;
  for (let attempt = 0; table === null; attempt += 1) {
    try {
      table = await runScopedQuery(db, userId, finalSql, today);
    } catch (error) {
      if (attempt >= REPAIR_ROUNDS) throw error;
      // Hand the database's complaint back to the model and let it fix the query.
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
      const complaint = cause instanceof Error ? cause.message : String(cause);
      conversation.push(
        { role: "assistant", content: JSON.stringify({ sql: finalSql, note }) },
        { role: "user", content: `PostgreSQL rejected that query: ${complaint}\nReturn a corrected query in the same JSON form.` },
      );
      const repaired = parseSqlDraft(await chat(config.url, config.model, conversation, { json: true }));
      if (!repaired.sql.trim()) throw error;
      finalSql = repaired.sql;
      note = repaired.note || note;
    }
  }

  const answer = await chat(config.url, config.model, [
    { role: "system", content: answerSystemPrompt(currency) },
    { role: "user", content: answerUserPrompt(question, table) },
  ]);
  return { answer: answer.trim(), note, sql: finalSql.trim(), table };
}
