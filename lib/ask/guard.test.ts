import { describe, expect, it } from "vitest";
import { guardSql, UnsafeSqlError } from "./guard";

describe("guardSql", () => {
  it("accepts a plain select and strips a trailing semicolon and code fence", () => {
    expect(guardSql("SELECT merchant, total_amount_cents FROM orders ORDER BY 2 DESC LIMIT 5;")).toBe(
      "SELECT merchant, total_amount_cents FROM orders ORDER BY 2 DESC LIMIT 5",
    );
    expect(guardSql("```sql\nselect count(*) as n from orders\n```")).toBe("select count(*) as n from orders");
  });

  it("accepts a query with its own WITH clause", () => {
    const query = "WITH spent AS (SELECT merchant, SUM(total_amount_cents) AS spent_cents FROM orders GROUP BY 1) SELECT * FROM spent";
    expect(guardSql(query)).toBe(query);
  });

  it.each([
    ["", /empty/],
    ["   ", /empty/],
    ["UPDATE orders SET merchant = 'x'", /Only SELECT/],
    ["DELETE FROM orders", /Only SELECT/],
    ["WITH x AS (DELETE FROM orders RETURNING *) SELECT * FROM x", /"delete" is not allowed/],
    ["SELECT 1; DROP TABLE orders", /single statement/],
    ["SELECT 1 -- comment", /Comments/],
    ["SELECT /* hi */ 1", /Comments/],
    ["SELECT * FROM users", /"users" is not allowed/],
    ["SELECT * FROM sessions", /"sessions" is not allowed/],
    ["SELECT * FROM public.orders", /"public"|Schema-qualified/],
    ["SELECT * FROM pg_catalog.pg_tables", /not allowed/],
    ["SELECT pg_sleep(10)", /"pg_sleep" is not allowed/],
    ["SELECT * INTO copy_of FROM orders", /"into" is not allowed/],
    ["SELECT current_setting('is_superuser')", /"current_setting" is not allowed/],
    ["SELECT * FROM orders WHERE id = $1", /placeholders/],
    ["WITH RECURSIVE t AS (SELECT 1 UNION ALL SELECT 1 FROM t) SELECT * FROM t", /"recursive" is not allowed/],
    ["WITH x AS (VALUES (1)) TABLE x", /Only SELECT/],
    [`SELECT ${"x".repeat(4001)}`, /too long/],
  ])("rejects %s", (query, message) => {
    expect(() => guardSql(query)).toThrow(UnsafeSqlError);
    expect(() => guardSql(query)).toThrow(message);
  });

  it("does not trip on column names that merely contain a forbidden word", () => {
    expect(guardSql("SELECT updated_at, showing, dataset FROM orders")).toBeTruthy();
  });
});
