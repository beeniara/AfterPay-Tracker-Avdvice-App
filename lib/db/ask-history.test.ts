import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteAsk, listAskHistory, listSharedQuestions, recordAsk } from "./ask-history";
import { createDb, type Db } from "./index";
import { users } from "./schema";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("ask history", () => {
  let db: Db;
  let me: string;
  let other: string;

  beforeAll(async () => {
    db = createDb(url, 1);
    const rows = await db
      .insert(users)
      .values([
        { email: `ask-me-${crypto.randomUUID()}@example.test` },
        { email: `ask-other-${crypto.randomUUID()}@example.test` },
      ])
      .returning({ id: users.id });
    me = rows[0]!.id;
    other = rows[1]!.id;
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, me));
    await db.delete(users).where(eq(users.id, other));
    await db.$client.end();
  });

  const entry = (question: string, answer: string | null = "an answer") => ({
    question,
    answer,
    sql: "SELECT 1",
    note: null,
    model: "test-model",
    rowCount: 1,
    error: answer === null ? "boom" : null,
    durationMs: 12,
  });

  it("stores and lists a person's own questions, newest first", async () => {
    await recordAsk(db, me, entry("first?"));
    await recordAsk(db, me, entry("second?"));
    await recordAsk(db, other, entry("someone else's?"));

    const mine = await listAskHistory(db, me);
    expect(mine.map((r) => r.question)).toEqual(["second?", "first?"]);
    expect(mine[0]).toMatchObject({ answer: "an answer", model: "test-model", rowCount: 1, durationMs: 12 });
  });

  it("shares only other people's answered questions, deduplicated", async () => {
    await recordAsk(db, other, entry("someone else's?"));
    await recordAsk(db, other, entry("failed one?", null));

    expect(await listSharedQuestions(db, me)).toEqual(["someone else's?"]);
    expect(await listSharedQuestions(db, other)).toEqual(["second?", "first?"]);
  });

  it("deletes only the owner's rows", async () => {
    const [row] = await listAskHistory(db, me, 1);
    expect(await deleteAsk(db, other, row!.id)).toBe(false);
    expect(await deleteAsk(db, me, row!.id)).toBe(true);
    expect((await listAskHistory(db, me)).map((r) => r.question)).toEqual(["first?"]);
  });
});
