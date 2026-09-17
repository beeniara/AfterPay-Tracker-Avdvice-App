import { describe, expect, it } from "vitest";
import { answerUserPrompt, isMoneyColumn, parseSqlDraft, sqlSystemPrompt } from "./prompt";

describe("parseSqlDraft", () => {
  it("reads a plain JSON object", () => {
    expect(parseSqlDraft('{"sql": "SELECT 1", "note": "one"}')).toEqual({ sql: "SELECT 1", note: "one" });
  });

  it("reads JSON wrapped in a code fence or surrounded by chatter", () => {
    expect(parseSqlDraft('Sure!\n```json\n{"sql":"SELECT 2","note":"two"}\n```\nDone.')).toEqual({ sql: "SELECT 2", note: "two" });
    expect(parseSqlDraft('Here you go: {"sql":"SELECT 3"} hope that helps')).toEqual({ sql: "SELECT 3", note: "" });
  });

  it("tolerates a missing or non-string sql field", () => {
    expect(parseSqlDraft('{"sql": null, "note": "cannot"}')).toEqual({ sql: "", note: "cannot" });
  });

  it("falls back to a sql fence or a bare statement", () => {
    expect(parseSqlDraft("```sql\nSELECT 4\n```")).toEqual({ sql: "SELECT 4", note: "" });
    expect(parseSqlDraft("  select 5  ")).toEqual({ sql: "select 5", note: "" });
    expect(parseSqlDraft("WITH a AS (SELECT 1) SELECT * FROM a")).toMatchObject({ sql: expect.stringMatching(/^WITH/) });
  });

  it("throws when nothing usable comes back", () => {
    expect(() => parseSqlDraft("I don't know")).toThrow(/usable query/);
    expect(() => parseSqlDraft("{not json")).toThrow(/usable query/);
  });
});

describe("prompts", () => {
  it("puts today, the currency and the table names in the system prompt", () => {
    const prompt = sqlSystemPrompt("2026-09-17", "NZD");
    expect(prompt).toContain("Today is 2026-09-17");
    expect(prompt).toContain("Amounts are in NZD");
    for (const table of ["providers(", "orders(", "instalments(", "fees(", "payments(", "refunds("]) {
      expect(prompt).toContain(table);
    }
  });

  it("recognises money columns by suffix", () => {
    expect(isMoneyColumn("spent_cents")).toBe(true);
    expect(isMoneyColumn("SPENT_CENTS")).toBe(true);
    expect(isMoneyColumn("merchant")).toBe(false);
    expect(isMoneyColumn("cents_total")).toBe(false);
  });

  it("renders rows with money converted and headers cleaned", () => {
    const text = answerUserPrompt("how much at glimmer?", {
      columns: ["merchant", "spent_cents", "orders"],
      rows: [["Glimmer Goods", 123456, 3], ["Other", "250", 1]],
      truncated: false,
    });
    expect(text).toContain("Question: how much at glimmer?");
    expect(text).toContain("Result (2 rows):");
    expect(text).toContain("merchant | spent | orders");
    expect(text).toContain("Glimmer Goods | 1234.56 | 3");
    expect(text).toContain("Other | 2.50 | 1");
  });

  it("notes hidden rows and capped queries", () => {
    const rows = Array.from({ length: 25 }, (_, i) => [i]);
    expect(answerUserPrompt("q", { columns: ["n"], rows, truncated: false })).toContain("(5 more rows not shown)");
    expect(answerUserPrompt("q", { columns: ["n"], rows, truncated: true })).toContain("(5 more rows not shown; the query was capped)");
    expect(answerUserPrompt("q", { columns: ["n"], rows: [[1]], truncated: true })).toContain("(the query was capped; there may be more rows)");
    expect(answerUserPrompt("q", { columns: ["n"], rows: [[1]], truncated: false })).toContain("Result (1 row):");
  });
});
