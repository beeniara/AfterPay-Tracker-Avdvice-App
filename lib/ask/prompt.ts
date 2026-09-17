export const MAX_ROWS = 50;
const ANSWER_ROWS = 20;

export const SCHEMA_DESCRIPTION = `Tables (already limited to this person's data; use exactly these names, never a schema prefix):
- providers(id uuid, name text, kind text one of 'bnpl','store_finance','loan','other')
- orders(id uuid, provider_id uuid references providers.id, merchant text, reference text, channel text one of 'online','in_store', purchased_at timestamptz, total_amount_cents integer, currency text, instalment_count integer, status text one of 'active','settled','cancelled', notes text)
- instalments(id uuid, order_id uuid references orders.id, sequence integer starting at 1, due_on date, principal_cents integer, paid_cents integer, pending_cents integer, waived_cents integer)
- fees(id uuid, instalment_id uuid references instalments.id, kind text one of 'late','establishment','other', amount_cents integer, incurred_on date, note text)
- payments(id uuid, instalment_id uuid references instalments.id, amount_cents integer, paid_on date, method text one of 'card','bank','cash','other', reference text)
- refunds(id uuid, order_id uuid references orders.id, amount_cents integer, refunded_on date, note text)

Ready-made balance tables (prefer these for anything about owing, remaining, overdue or payments left; the maths is already done):
- instalment_balances(instalment_id uuid, order_id uuid, sequence integer, due_on date, principal_cents, fees_cents, paid_cents, pending_cents, waived_cents, owed_cents integer, is_paid boolean, is_overdue boolean)
- order_balances(order_id uuid, merchant text, provider_id uuid, purchased_at timestamptz, total_amount_cents, instalment_count integer, status text, owed_cents bigint, paid_cents bigint, fees_cents bigint, remaining_count bigint, paid_count bigint, next_due_on date)

Facts:
- All money is in integer cents. Keep every money column in the result named with a _cents suffix, e.g. SUM(total_amount_cents) AS spent_cents.
- "Payments left", "remaining", "still to pay" or "owing" mean unpaid instalments: use order_balances.remaining_count / owed_cents or instalment_balances WHERE NOT is_paid. The payments table is only the history of money already paid; never use it to answer what is left.
- "Spent" or "bought" means orders.total_amount_cents; "paid" means order_balances.paid_cents.
- Provider totals: join order_balances.provider_id to providers.id.
- orders.status is 'active' while any instalment is unpaid, 'settled' once all are paid, 'cancelled' if voided.
- Match merchant and provider names case-insensitively with ILIKE '%name%'.
- Dates: purchased_at is a timestamp; use purchased_at::date for day grouping and date_trunc('month', purchased_at) for months.`;

export function sqlSystemPrompt(today: string, currency: string): string {
  return `You translate questions about a personal instalment-plan tracker (buy-now-pay-later orders) into one PostgreSQL SELECT query.

${SCHEMA_DESCRIPTION}

Today is ${today}. Amounts are in ${currency}.

Rules:
- Exactly one SELECT statement (a WITH ... SELECT is fine). No semicolon, no comments, no INSERT/UPDATE/DELETE, nothing that changes data.
- Give columns short readable snake_case aliases. Include the merchant or a date wherever it helps the person understand the rows.
- ORDER BY something sensible and LIMIT ${MAX_ROWS} unless the question is a single total.
- If the question cannot be answered from these tables, set "sql" to an empty string and explain in "note".

Respond with ONLY a JSON object of the form {"sql": "...", "note": "one short sentence on how you read the question"}.`;
}

export interface SqlDraft {
  sql: string;
  note: string;
}

export function parseSqlDraft(text: string): SqlDraft {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) candidates.unshift(fenced[1].trim());
  const braces = trimmed.indexOf("{");
  if (braces >= 0) candidates.push(trimmed.slice(braces, trimmed.lastIndexOf("}") + 1));

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (typeof parsed === "object" && parsed !== null && "sql" in parsed) {
        const sql = typeof parsed.sql === "string" ? parsed.sql : "";
        const note = "note" in parsed && typeof parsed.note === "string" ? parsed.note : "";
        return { sql, note };
      }
    } catch {
      // try the next candidate
    }
  }

  const sqlFence = /```sql\s*([\s\S]*?)```/i.exec(trimmed);
  if (sqlFence?.[1]) return { sql: sqlFence[1].trim(), note: "" };
  if (/^(select|with)\b/i.test(trimmed)) return { sql: trimmed, note: "" };
  throw new Error("The model did not return a usable query");
}

export type CellValue = string | number | boolean | null;

export interface ResultTable {
  columns: string[];
  rows: CellValue[][];
  truncated: boolean;
}

export function isMoneyColumn(name: string): boolean {
  return /_cents$/i.test(name);
}

function centsToUnits(value: CellValue): string {
  const cents = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(cents)) return String(value);
  return (cents / 100).toFixed(2);
}

export function answerSystemPrompt(currency: string): string {
  return `You answer questions about someone's instalment-plan (buy-now-pay-later) orders using only the query result you are given. Money values have already been converted to ${currency}. Write one to three short plain sentences, no markdown, no headings, no lists. Quote the key numbers and names from the rows. If the result is empty, say so plainly. Never mention SQL or tables.`;
}

export function answerUserPrompt(question: string, table: ResultTable): string {
  const shown = table.rows.slice(0, ANSWER_ROWS);
  const header = table.columns.map((c) => (isMoneyColumn(c) ? c.replace(/_cents$/i, "") : c));
  const lines = shown.map((row) =>
    row
      .map((cell, i) => (isMoneyColumn(table.columns[i]!) ? centsToUnits(cell) : String(cell ?? "")))
      .join(" | "),
  );
  const more =
    table.rows.length > shown.length
      ? `\n(${table.rows.length - shown.length} more rows not shown${table.truncated ? "; the query was capped" : ""})`
      : table.truncated
        ? "\n(the query was capped; there may be more rows)"
        : "";
  return `Question: ${question}\n\nResult (${table.rows.length} row${table.rows.length === 1 ? "" : "s"}):\n${header.join(" | ")}\n${lines.join("\n")}${more}`;
}
