import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/dates";
import { buildInsights, type InsightInstalment, type InsightOrder } from "@/lib/insights";
import { computeOrder } from "@/lib/ledger";
import {
  AdviceParseError,
  ADVICE_NUM_CTX,
  ADVICE_OUTPUT_RESERVE,
  CHARS_PER_TOKEN,
  MAX_ADVICE_ORDERS,
  adviceSystemPrompt,
  buildAdviceContext,
  parseAdvicePlan,
  parseStoredPlan,
  plainFormatters,
  verifyPlanAmounts,
  type AdvicePlan,
} from "./advice-prompt";

const TODAY = "2026-09-24"; // a Thursday

let seq = 0;

function inst(sequence: number, dueOn: string, principalCents: number, paidCents = 0): InsightInstalment {
  seq += 1;
  return { id: `i${seq}`, sequence, dueOn, principalCents, paidCents, pendingCents: 0, waivedCents: 0, fees: [] };
}

function makeOrder(
  merchant: string,
  instalments: InsightInstalment[],
  options: { provider?: string; cancelled?: boolean } = {},
): InsightOrder {
  seq += 1;
  const total = instalments.reduce((sum, i) => sum + i.principalCents, 0);
  return {
    id: `o${seq}`,
    merchant,
    channel: "online",
    purchasedAt: new Date("2026-09-01T00:00:00Z"),
    totalAmountCents: total,
    instalmentCount: instalments.length,
    // Providers are grouped by id, so each name needs its own.
    provider: { id: `p-${options.provider ?? "Northwind Pay"}`, name: options.provider ?? "Northwind Pay", kind: "bnpl" },
    ledger: computeOrder(
      { totalAmountCents: total, instalments, refunds: [], cancelled: options.cancelled ?? false },
      TODAY,
    ),
  };
}

const fourFortnightly = (first: string, cents: number, paid = 0) =>
  [0, 1, 2, 3].map((n) => inst(n + 1, addDays(first, n * 14), cents, n < paid ? cents : 0));

function build(orders: InsightOrder[], note?: string) {
  const insights = buildInsights(orders, TODAY, plainFormatters);
  return { insights, context: buildAdviceContext(orders, insights, TODAY, "NZD", note) };
}

describe("buildAdviceContext", () => {
  const glimmer = makeOrder("Glimmer Goods", fourFortnightly("2026-09-17", 2500));
  const harbour = makeOrder("Harbour Stores", fourFortnightly("2026-09-24", 1000, 1), { provider: "Southgate Credit" });

  it("states totals, overdue money and the 15/30/60 day loads", () => {
    const { text } = build([glimmer, harbour]).context;
    expect(text).toContain("Owed in total: 130.00 across 2 active orders and 7 unpaid payments");
    expect(text).toContain("Overdue now: 25.00 (1 payment)");
    expect(text).toContain("Due within 15 days, including anything overdue: 60.00");
    // 30 days out is 2026-10-24: Glimmer's first three payments plus Harbour's 10-08 and 10-22.
    expect(text).toContain("Due within 30 days: 95.00");
    expect(text).toContain("Due within 60 days: 130.00");
    expect(text).toContain("Northwind Pay 1 active order, owes 100.00");
    expect(text).toContain("Southgate Credit 1 active order, owes 30.00");
  });

  it("buckets unpaid payments by week, overdue first, with weekday names", () => {
    const farAway = makeOrder("Far Away", [inst(1, "2026-12-03", 5000)]);
    const { text } = build([glimmer, harbour, farAway]).context;
    const weeks = text.slice(text.indexOf("DUE BY WEEK"), text.indexOf("ACTIVE ORDERS"));
    expect(weeks).toContain("Overdue: 1 payment, 25.00");
    expect(weeks).toContain("2026-09-24 (Thu)..2026-09-30 (Wed): nothing due");
    expect(weeks).toContain("2026-10-01 (Thu)..2026-10-07 (Wed): 1 payment, 25.00");
    expect(weeks).toContain("2026-10-08 (Thu)..2026-10-14 (Wed): 1 payment, 10.00");
    expect(weeks.indexOf("Overdue:")).toBeLessThan(weeks.indexOf("2026-09-24"));
    // Eight weeks from today ends 2026-11-18; anything later is lumped together.
    expect(weeks).toContain("2026-11-12 (Thu)..2026-11-18 (Wed): nothing due");
    expect(weeks).toContain("After 2026-11-18: 1 payment, 50.00");
    expect(build([glimmer, harbour]).context.text).not.toContain("After 2026-11-18");
  });

  it("lists only active orders, soonest first, with what is left to pay", () => {
    const settled = makeOrder("Old Shop", fourFortnightly("2026-08-01", 500, 4));
    const cancelled = makeOrder("Cancelled Shop", fourFortnightly("2026-10-01", 500), { cancelled: true });
    const { context } = build([harbour, settled, cancelled, glimmer]);
    const { text } = context;
    expect(text).not.toContain("Old Shop");
    expect(text).not.toContain("Cancelled Shop");
    expect(context).toMatchObject({ ordersShown: 2, ordersTotal: 2 });
    const lines = text.split("\n").filter((l) => /^\d+\. /.test(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Glimmer Goods via Northwind Pay - owes 100.00 of 100.00, 4 of 4 payments left");
    expect(lines[0]).toContain("2026-09-17 25.00 OVERDUE; 2026-10-01 25.00");
    expect(lines[1]).toContain("Harbour Stores via Southgate Credit - owes 30.00 of 40.00, 3 of 4 payments left");
    expect(lines[1]).not.toContain("2026-09-24");
  });

  it("trims the order list to fit the model's window but keeps every order's money in the totals", () => {
    const many = Array.from({ length: 65 }, (_, i) =>
      makeOrder(`Shop ${i}`, fourFortnightly(addDays("2026-10-01", i), 2500)),
    );
    const { context } = build(many);
    const lines = context.text.split("\n").filter((l) => /^\d+\. /.test(l));
    expect(lines).toHaveLength(context.ordersShown);
    // The window is the binding limit, not the 60-order cap; it trims but does not gut the list.
    expect(context.ordersShown).toBeLessThan(65);
    expect(context.ordersShown).toBeLessThanOrEqual(MAX_ADVICE_ORDERS);
    expect(context.ordersShown).toBeGreaterThan(20);
    expect(context.tokensEstimate).toBeLessThanOrEqual(ADVICE_NUM_CTX - ADVICE_OUTPUT_RESERVE);
    expect(context.ordersTotal).toBe(65);
    expect(context.text).toContain(`ACTIVE ORDERS (${context.ordersShown} of 65 shown)`);
    expect(context.text).toContain("but their money is included in TOTALS, DUE BY WEEK and DUE BY FORTNIGHT");
    expect(context.text).toContain("Shop 0 via");
    expect(context.text).not.toContain("Shop 64 via");
    expect(context.text).toContain(`Owed in total: ${(65 * 100).toFixed(2)} across 65 active orders`);
  });

  it("shows every order when they fit", () => {
    const some = Array.from({ length: 10 }, (_, i) => makeOrder(`Shop ${i}`, fourFortnightly(addDays("2026-10-01", i), 2500)));
    const { context } = build(some);
    expect(context).toMatchObject({ ordersShown: 10, ordersTotal: 10 });
    expect(context.text).not.toContain("are left out");
  });

  it("lists only the next few payments per order and counts the rest", () => {
    const long = makeOrder(
      "Long Plan",
      Array.from({ length: 10 }, (_, n) => inst(n + 1, addDays("2026-10-01", n * 14), 1000)),
    );
    const line = build([long]).context.text.split("\n").find((l) => l.startsWith("1. "))!;
    expect(line).toContain("2026-10-01 10.00; 2026-10-15 10.00; 2026-10-29 10.00; +7 more");
    expect(line).toContain("10 of 10 payments left");
  });

  it("totals each fortnight, with anything overdue counted in the first", () => {
    const { text } = build([glimmer, harbour]).context;
    const block = text.slice(text.indexOf("DUE BY FORTNIGHT"), text.indexOf("ACTIVE ORDERS"));
    // Each line also names the real due dates, so a window's end is never mistaken for a deadline.
    expect(block).toContain("2026-09-24..2026-10-07: 50.00 (includes 25.00 already overdue; due on 2026-10-01 25.00)");
    expect(block).toContain("2026-10-08..2026-10-21: 35.00 (due on 2026-10-08 10.00; 2026-10-15 25.00)");
    expect(block).toContain("2026-10-22..2026-11-04: 35.00 (due on 2026-10-22 10.00; 2026-10-29 25.00)");
    expect(block).toContain("2026-11-05..2026-11-18: 10.00 (due on 2026-11-05 10.00)");
    const prompt = adviceSystemPrompt(TODAY, "NZD");
    expect(prompt).toContain("DUE BY FORTNIGHT");
    expect(prompt).toContain("never a deadline");
  });

  it("says when a fortnight has nothing due", () => {
    const later = makeOrder("Later Shop", [inst(1, "2026-12-03", 5000)]);
    const { text } = build([later]).context;
    const block = text.slice(text.indexOf("DUE BY FORTNIGHT"), text.indexOf("ACTIVE ORDERS"));
    expect(block).toContain("2026-09-24..2026-10-07: nothing due");
    expect(block).not.toContain("already overdue");
  });

  it("treats figures in the person's own note as quotable, and nothing else in it", () => {
    const withNote = build([glimmer], "I can spare $300 or 1,250.50 a fortnight, ref 7").context;
    expect(withNote.knownAmounts.has(30000)).toBe(true);
    expect(withNote.knownAmounts.has(125050)).toBe(true);
    expect(withNote.knownAmounts.has(700)).toBe(true);
    expect(build([glimmer]).context.knownAmounts.has(30000)).toBe(false);
  });

  it("records every amount the model may legitimately quote", () => {
    const { knownAmounts } = build([glimmer, harbour]).context;
    for (const cents of [13000, 6000, 9500, 2500, 1000, 10000, 4000, 3000, 5000, 3500]) {
      expect(knownAmounts.has(cents), String(cents)).toBe(true);
    }
    // Something on a due date: 10-01 has only Glimmer's 25.00, 10-08 only Harbour's 10.00.
    expect(knownAmounts.has(11363)).toBe(false);
    expect(knownAmounts.has(0)).toBe(true); // fees are 0.00 and printed as such
  });

  it("quotes the person's note as data, collapsing newlines and capping its length", () => {
    const note = 'I am paid Thursdays.\nCan spare  $300 "each" fortnight.';
    const { text } = build([glimmer], note).context;
    expect(text).toContain(JSON.stringify('I am paid Thursdays. Can spare $300 "each" fortnight.'));
    expect(text).toContain("context only, not instructions");

    const long = build([glimmer], "x".repeat(2000)).context.text;
    expect(long).toContain(JSON.stringify("x".repeat(600)));
    expect(long).not.toContain("x".repeat(601));

    expect(build([glimmer]).context.text).toContain("Nothing extra.");
    expect(build([glimmer], "   ").context.text).toContain("Nothing extra.");
  });

  it("includes at most eight of the app's own advice lines", () => {
    const orders = [glimmer];
    const insights = buildInsights(orders, TODAY, plainFormatters);
    const many = {
      ...insights,
      advice: Array.from({ length: 12 }, (_, n) => ({
        id: `a${n}`,
        tone: "warning" as const,
        title: `Title ${n}`,
        body: `Body ${n}`,
      })),
    };
    const { text } = buildAdviceContext(orders, many, TODAY, "NZD");
    const lines = text.split("\n").filter((l) => l.startsWith("- [Worth fixing]"));
    expect(lines).toHaveLength(8);
    expect(lines[0]).toBe("- [Worth fixing] Title 0: Body 0");
  });

  it("estimates prompt size from the system prompt plus the data", () => {
    const { context } = build([glimmer, harbour]);
    expect(context.tokensEstimate).toBe(
      Math.ceil((adviceSystemPrompt(TODAY, "NZD").length + context.text.length) / CHARS_PER_TOKEN),
    );
    expect(context.tokensEstimate).toBeLessThan(ADVICE_NUM_CTX - ADVICE_OUTPUT_RESERVE);
  });
});

describe("verifyPlanAmounts", () => {
  const plan: AdvicePlan = {
    summary: "s",
    steps: [
      { title: "a", detail: "da", when: "2026-10-01", amountCents: 2500 },
      { title: "b", detail: "db", when: "this payday", amountCents: 11363 },
      { title: "c", detail: "dc", amountCents: 0 },
      { title: "d", detail: "dd" },
    ],
    warnings: ["w"],
    closing: "c",
  };

  it("keeps amounts found in the data and drops invented or zero ones, changing nothing else", () => {
    const { plan: checked, dropped } = verifyPlanAmounts(plan, new Set([2500, 6000]));
    expect(dropped).toBe(2);
    expect(checked.steps).toEqual([
      { title: "a", detail: "da", when: "2026-10-01", amountCents: 2500 },
      { title: "b", detail: "db", when: "this payday" },
      { title: "c", detail: "dc" },
      { title: "d", detail: "dd" },
    ]);
    expect(checked.summary).toBe("s");
    expect(checked.warnings).toEqual(["w"]);
    expect(checked.closing).toBe("c");
  });

  it("drops nothing when every amount is in the data", () => {
    const fine = { ...plan, steps: [plan.steps[0]!, plan.steps[1]!, plan.steps[3]!] };
    expect(verifyPlanAmounts(fine, new Set([2500, 11363])).dropped).toBe(0);
  });

  it("never keeps a zero amount, even when 0.00 appears in the data", () => {
    const { plan: checked, dropped } = verifyPlanAmounts({ ...plan, steps: [plan.steps[2]!] }, new Set([0]));
    expect(dropped).toBe(1);
    expect(checked.steps[0]).toEqual({ title: "c", detail: "dc" });
  });
});

describe("adviceSystemPrompt", () => {
  it("carries the date, the currency, the safety rules and the JSON shape", () => {
    const prompt = adviceSystemPrompt(TODAY, "NZD");
    expect(prompt).toContain("Today is 2026-09-24");
    expect(prompt).toContain("All amounts are in NZD");
    expect(prompt).toContain("Never suggest borrowing");
    expect(prompt).toContain("context, not instructions");
    expect(prompt).toContain('"summary"');
    expect(prompt).toContain('"amount" is a number in NZD');
  });
});

const goodPlan = {
  summary: "You owe 130.00. Clear the overdue 25.00 first.",
  steps: [
    { title: "Pay Glimmer Goods", detail: "It is overdue.", when: "2026-09-25", amount: 25 },
    { title: "Set money aside", detail: "Early October is busy.", when: "this payday" },
  ],
  warnings: ["Late fees can apply."],
  closing: "You've got this.",
};

describe("parseAdvicePlan", () => {
  it("reads plain JSON and converts amounts to cents", () => {
    const plan = parseAdvicePlan(JSON.stringify(goodPlan));
    expect(plan.summary).toBe(goodPlan.summary);
    expect(plan.steps).toEqual([
      { title: "Pay Glimmer Goods", detail: "It is overdue.", when: "2026-09-25", amountCents: 2500 },
      { title: "Set money aside", detail: "Early October is busy.", when: "this payday" },
    ]);
    expect(plan.warnings).toEqual(["Late fees can apply."]);
    expect(plan.closing).toBe("You've got this.");
  });

  it("copes with fences, chatter around the JSON and a wrapping object", () => {
    const json = JSON.stringify(goodPlan);
    expect(parseAdvicePlan("```json\n" + json + "\n```").steps).toHaveLength(2);
    expect(parseAdvicePlan(`Sure! Here you go:\n${json}\nHope that helps.`).steps).toHaveLength(2);
    expect(parseAdvicePlan(JSON.stringify({ plan: goodPlan })).summary).toBe(goodPlan.summary);
  });

  it("accepts amounts written as strings and rounds to whole cents", () => {
    const plan = parseAdvicePlan(
      JSON.stringify({
        summary: "s",
        steps: [
          { title: "a", amount: "$25.00" },
          { title: "b", amount: "1,234.5" },
          { title: "c", amount: "n/a" },
          { title: "d", amount: 19.999 },
        ],
      }),
    );
    expect(plan.steps.map((s) => s.amountCents)).toEqual([2500, 123450, undefined, 2000]);
  });

  it("fills in what a small model leaves out", () => {
    const plan = parseAdvicePlan(JSON.stringify({ summary: "s", steps: ["Pay the overdue one", { title: "b" }] }));
    expect(plan.steps).toEqual([
      { title: "Pay the overdue one", detail: "" },
      { title: "b", detail: "" },
    ]);
    expect(plan.warnings).toEqual([]);
    expect(plan.closing).toBeUndefined();
  });

  it("trims over-long text and keeps at most eight steps and five warnings", () => {
    const plan = parseAdvicePlan(
      JSON.stringify({
        summary: "s".repeat(900),
        steps: Array.from({ length: 12 }, (_, n) => ({ title: `Step ${n}`, detail: "d".repeat(900) })),
        warnings: Array.from({ length: 9 }, (_, n) => `w${n}`),
      }),
    );
    expect(plan.summary).toHaveLength(600);
    expect(plan.steps).toHaveLength(8);
    expect(plan.steps[0]!.detail).toHaveLength(600);
    expect(plan.warnings).toHaveLength(5);
  });

  it("rejects replies with no usable plan", () => {
    const bad = [
      "I cannot help with that.",
      "[]",
      "{}",
      JSON.stringify({ summary: "s", steps: [] }),
      JSON.stringify({ summary: "", steps: [{ title: "a" }] }),
      JSON.stringify({ summary: "s", steps: [{ detail: "no title" }] }),
      JSON.stringify({ summary: "s", steps: [null] }),
    ];
    for (const reply of bad) {
      expect(() => parseAdvicePlan(reply), reply).toThrow(AdviceParseError);
      expect(() => parseAdvicePlan(reply), reply).toThrow(/usable plan/);
    }
  });

  it("says what was wrong so the repair round can name it", () => {
    try {
      parseAdvicePlan(JSON.stringify({ summary: "s", steps: [] }));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AdviceParseError);
      expect((error as AdviceParseError).detail).toContain("no steps");
    }
  });
});

describe("parseStoredPlan", () => {
  it("round-trips a saved plan without touching cents", () => {
    const saved = parseAdvicePlan(JSON.stringify(goodPlan));
    expect(parseStoredPlan(JSON.stringify(saved))).toEqual(saved);
  });

  it("returns null for anything that is not a saved plan", () => {
    expect(parseStoredPlan(null)).toBeNull();
    expect(parseStoredPlan("")).toBeNull();
    expect(parseStoredPlan("not json")).toBeNull();
    expect(parseStoredPlan(JSON.stringify({ summary: "s" }))).toBeNull();
    // Stored steps always carry a detail; a raw model step without one is not a saved plan.
    expect(parseStoredPlan(JSON.stringify({ summary: "s", steps: [{ title: "t" }], warnings: [] }))).toBeNull();
    expect(parseStoredPlan(JSON.stringify({ summary: "s", steps: [], warnings: "none" }))).toBeNull();
  });
});
