import { describe, expect, it } from "vitest";
import {
  buildPage,
  listParamsSchema,
  orderListQuerySchema,
  parseSearchParams,
} from "./params";

describe("listParamsSchema", () => {
  it("applies defaults", () => {
    expect(parseSearchParams(listParamsSchema, new URLSearchParams())).toEqual({
      ok: true,
      value: { offset: 0, limit: 25, orderBy: "purchasedAt", ascending: false },
    });
  });

  it("clamps limit silently at 200", () => {
    const result = parseSearchParams(listParamsSchema, { limit: "999" });
    expect(result.ok && result.value.limit).toBe(200);
  });

  it("rejects rubbish with a readable message", () => {
    const result = parseSearchParams(listParamsSchema, { offset: "-3", orderBy: "nope" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/offset/);
    expect(!result.ok && result.error).toMatch(/orderBy/);
  });
});

describe("orderListQuerySchema", () => {
  it("accepts filters and treats blanks as unset", () => {
    const result = parseSearchParams(orderListQuerySchema, {
      q: "  kmart ",
      merchant: "",
      status: "active",
      from: "2026-01-01",
      ascending: "true",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        offset: 0,
        limit: 25,
        orderBy: "purchasedAt",
        ascending: true,
        q: "kmart",
        status: "active",
        from: "2026-01-01",
      },
    });
  });

  it("rejects bad dates and ids", () => {
    expect(parseSearchParams(orderListQuerySchema, { from: "1/1/2026" }).ok).toBe(false);
    expect(parseSearchParams(orderListQuerySchema, { providerId: "abc" }).ok).toBe(false);
  });

  it("takes the first value of repeated params", () => {
    const result = parseSearchParams(orderListQuerySchema, { status: ["settled", "active"] });
    expect(result.ok && result.value.status).toBe("settled");
  });
});

describe("buildPage", () => {
  it("links to the next page only when there is one", () => {
    const page = buildPage([1, 2], 5, { offset: 0, limit: 2 }, "http://x/api/orders?q=a&limit=2");
    expect(page).toMatchObject({ totalResults: 5, offset: 0, limit: 2, results: [1, 2] });
    expect(page.nextPageUrl).toBe("/api/orders?q=a&limit=2&offset=2");
    expect(buildPage([5], 5, { offset: 4, limit: 2 }, "http://x/api/orders").nextPageUrl).toBeNull();
  });
});
