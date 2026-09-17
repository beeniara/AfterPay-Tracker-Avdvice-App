import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { DbClient } from "./index";
import { askHistory, type AskHistoryRow } from "./schema";

export interface RecordAsk {
  question: string;
  answer: string | null;
  sql: string | null;
  note: string | null;
  model: string | null;
  rowCount: number | null;
  error: string | null;
  durationMs: number;
}

export async function recordAsk(db: DbClient, userId: string, input: RecordAsk): Promise<AskHistoryRow> {
  const [row] = await db.insert(askHistory).values({ userId, ...input }).returning();
  return row!;
}

export async function listAskHistory(db: DbClient, userId: string, limit = 20): Promise<AskHistoryRow[]> {
  return db.query.askHistory.findMany({
    where: eq(askHistory.userId, userId),
    orderBy: [desc(askHistory.createdAt)],
    limit,
  });
}

// Question text only, from everyone else, so one person's answers (which
// carry their own figures) never show up for another.
export async function listSharedQuestions(db: DbClient, exceptUserId: string, limit = 12): Promise<string[]> {
  const rows = await db
    .select({ question: askHistory.question, latest: sql<string>`max(${askHistory.createdAt})` })
    .from(askHistory)
    .where(and(ne(askHistory.userId, exceptUserId), sql`${askHistory.answer} is not null`))
    .groupBy(askHistory.question)
    .orderBy(desc(sql`max(${askHistory.createdAt})`))
    .limit(limit);
  return rows.map((r) => r.question);
}

export async function deleteAsk(db: DbClient, userId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(askHistory)
    .where(and(eq(askHistory.id, id), eq(askHistory.userId, userId)))
    .returning({ id: askHistory.id });
  return deleted.length > 0;
}
