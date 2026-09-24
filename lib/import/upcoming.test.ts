import { describe, expect, it } from "vitest";
import { chainRows, parseUpcomingRows, planUpcoming, type ExistingOrder, type UpcomingOptions } from "./upcoming";

const TODAY = "2026-09-24";

const options: UpcomingOptions = {
  providerName: "Northwind Pay",
  currency: "NZD",
  intervalDays: 14,
  reopenSettled: true,
  settleMissing: true,
  createUnmatched: true,
};

const row = (merchant: string, paymentNo: string, dueDate: string, amount: string) => ({ merchant, paymentNo, dueDate, amount });

// An order the way the earlier history import would have written it: cycle
// dates a week off the provider's real collection day, first instalment paid.
function order(overrides: Partial<ExistingOrder> & { id: string }): ExistingOrder {
  const base: ExistingOrder = {
    id: overrides.id,
    merchant: "Glimmer Goods",
    reference: "A-1",
    status: "active",
    purchasedOn: "2026-09-16",
    instalmentCount: 4,
    totalAmountCents: 2799,
    instalments: [
      { id: `${overrides.id}-1`, sequence: 1, dueOn: "2026-09-24", principalCents: 700, paidCents: 700, pendingCents: 0, waivedCents: 0, feesCents: 0 },
      { id: `${overrides.id}-2`, sequence: 2, dueOn: "2026-10-08", principalCents: 700, paidCents: 0, pendingCents: 0, waivedCents: 0, feesCents: 0 },
      { id: `${overrides.id}-3`, sequence: 3, dueOn: "2026-10-22", principalCents: 700, paidCents: 0, pendingCents: 0, waivedCents: 0, feesCents: 0 },
      { id: `${overrides.id}-4`, sequence: 4, dueOn: "2026-11-05", principalCents: 699, paidCents: 0, pendingCents: 0, waivedCents: 0, feesCents: 0 },
    ],
  };
  return { ...base, ...overrides };
}

describe("parseUpcomingRows", () => {
  it("reads payment numbers, dates and amounts, collecting errors per line", () => {
    const { rows, errors } = parseUpcomingRows(
      [
        row("Glimmer Goods", "2 of 4", "2026-10-08", "7.00"),
        row("Glimmer Goods", "3/4", "08/10/2026", "$7.00"),
        row("", "1 of 4", "2026-10-08", "7.00"),
        row("Glimmer Goods", "second", "2026-10-08", "7.00"),
        row("Glimmer Goods", "5 of 4", "2026-10-08", "7.00"),
        row("Glimmer Goods", "1 of 4", "soon", "7.00"),
        row("Glimmer Goods", "1 of 4", "2026-10-08", "0"),
      ],
      "NZD",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ line: 2, sequence: 2, count: 4, dueOn: "2026-10-08", amountCents: 700 });
    expect(rows[1]).toMatchObject({ line: 3, sequence: 3, count: 4, dueOn: "2026-10-08", amountCents: 700 });
    expect(errors.map((e) => e.line)).toEqual([4, 5, 6, 7, 8]);
  });
});

describe("chainRows", () => {
  it("links instalments of one order and keeps look-alike orders apart", () => {
    const { rows } = parseUpcomingRows(
      [
        row("Glimmer Goods", "2 of 4", "2026-10-08", "7.00"),
        row("Glimmer Goods", "4 of 4", "2026-11-05", "6.99"),
        row("Glimmer Goods", "3 of 4", "2026-10-22", "7.00"),
        // Same merchant and amount, a week later: a different order.
        row("Glimmer Goods", "2 of 4", "2026-10-15", "7.00"),
        row("Glimmer Goods", "3 of 4", "2026-10-29", "7.00"),
        // Different amount on the same dates: also a different order.
        row("Glimmer Goods", "3 of 4", "2026-10-22", "9.50"),
      ],
      "NZD",
    );
    const chains = chainRows(rows, 14);
    expect(chains.map((c) => c.rows.map((r) => `${r.sequence}@${r.dueOn}`))).toEqual([
      ["2@2026-10-08", "3@2026-10-22", "4@2026-11-05"],
      ["2@2026-10-15", "3@2026-10-29"],
      ["3@2026-10-22"],
    ]);
    expect(chains[0]?.firstDueOn).toBe("2026-09-24");
    expect(chains[2]?.firstDueOn).toBe("2026-09-24");
  });

  it("allows a gap where an instalment was paid early", () => {
    const { rows } = parseUpcomingRows(
      [row("Glimmer Goods", "2 of 4", "2026-10-08", "7.00"), row("Glimmer Goods", "4 of 4", "2026-11-05", "6.99")],
      "NZD",
    );
    expect(chainRows(rows, 14)).toHaveLength(1);
  });
});

describe("planUpcoming", () => {
  it("re-dates a matched active order and marks the unlisted instalments paid", () => {
    const plan = planUpcoming(
      [
        row("Glimmer Goods", "3 of 4", "2026-10-15", "7.00"),
        row("Glimmer Goods", "4 of 4", "2026-10-29", "6.99"),
      ],
      [order({ id: "o1" })],
      options,
      TODAY,
    );
    expect(plan.errors).toEqual([]);
    expect(plan.creates).toEqual([]);
    expect(plan.settles).toEqual([]);
    expect(plan.updates).toHaveLength(1);
    const u = plan.updates[0]!;
    expect(u.redate).toEqual([
      { instalmentId: "o1-3", sequence: 3, from: "2026-10-22", to: "2026-10-15" },
      { instalmentId: "o1-4", sequence: 4, from: "2026-11-05", to: "2026-10-29" },
    ]);
    expect(u.markPaid).toEqual([{ instalmentId: "o1-2", sequence: 2, amountCents: 700, paidOn: TODAY }]);
    expect(u.reopen).toEqual([]);
    expect(u).toMatchObject({ owingBefore: 2099, owingAfter: 1399 });
    expect(plan).toMatchObject({ owingBefore: 2099, owingAfter: 1399, upcomingCents: 1399 });
  });

  it("re-opens instalments the app thought were paid when the export still lists them", () => {
    const plan = planUpcoming(
      [
        row("Glimmer Goods", "1 of 4", "2026-10-01", "7.00"),
        row("Glimmer Goods", "2 of 4", "2026-10-15", "7.00"),
        row("Glimmer Goods", "3 of 4", "2026-10-29", "7.00"),
        row("Glimmer Goods", "4 of 4", "2026-11-12", "6.99"),
      ],
      [order({ id: "o1", purchasedOn: "2026-09-17" })],
      options,
      TODAY,
    );
    const u = plan.updates[0]!;
    expect(u.reopen).toEqual([{ instalmentId: "o1-1", sequence: 1, amountCents: 700, paidTo: 0 }]);
    expect(u.redate.map((r) => r.to)).toEqual(["2026-10-01", "2026-10-15", "2026-10-29", "2026-11-12"]);
    expect(u.owingAfter).toBe(2799);
  });

  it("prefers the order whose dates fit best and never matches outside the purchase window", () => {
    const older = order({ id: "old", purchasedOn: "2026-08-20" });
    const newer = order({ id: "new", purchasedOn: "2026-09-16" });
    const plan = planUpcoming(
      [row("Glimmer Goods", "2 of 4", "2026-10-08", "7.00")],
      [older, newer],
      { ...options, settleMissing: false },
      TODAY,
    );
    expect(plan.updates.map((u) => u.orderId)).toEqual(["new"]);
  });

  it("matches an order whose remaining instalment shrank after a refund", () => {
    // App split 24.14 as 6.04 ×3 + 6.02; the provider refunded 0.46 off the
    // last one, so the export lists 5.69.
    const refunded = order({
      id: "r1",
      purchasedOn: "2026-08-09",
      totalAmountCents: 2414,
      instalments: [
        { id: "r1-1", sequence: 1, dueOn: "2026-08-13", principalCents: 604, paidCents: 604, pendingCents: 0, waivedCents: 0, feesCents: 0 },
        { id: "r1-2", sequence: 2, dueOn: "2026-08-27", principalCents: 604, paidCents: 604, pendingCents: 0, waivedCents: 0, feesCents: 0 },
        { id: "r1-3", sequence: 3, dueOn: "2026-09-10", principalCents: 604, paidCents: 604, pendingCents: 0, waivedCents: 0, feesCents: 0 },
        { id: "r1-4", sequence: 4, dueOn: "2026-09-24", principalCents: 602, paidCents: 33, pendingCents: 0, waivedCents: 0, feesCents: 0 },
      ],
    });
    const plan = planUpcoming([row("Glimmer Goods", "4 of 4", "2026-10-01", "5.69")], [refunded], options, TODAY);
    expect(plan.creates).toEqual([]);
    expect(plan.updates[0]).toMatchObject({ orderId: "r1", reopen: [], owingBefore: 569, owingAfter: 569 });
    expect(plan.updates[0]?.redate).toEqual([{ instalmentId: "r1-4", sequence: 4, from: "2026-09-24", to: "2026-10-01" }]);
  });

  it("undoes a recorded part-payment on an instalment the export still lists in full", () => {
    const partly = order({
      id: "p1",
      instalments: order({ id: "p1" }).instalments.map((i) => (i.sequence === 2 ? { ...i, paidCents: 500 } : i)),
    });
    const plan = planUpcoming(
      [row("Glimmer Goods", "2 of 4", "2026-10-08", "7.00"), row("Glimmer Goods", "3 of 4", "2026-10-22", "7.00"), row("Glimmer Goods", "4 of 4", "2026-11-05", "6.99")],
      [partly],
      options,
      TODAY,
    );
    expect(plan.updates[0]?.reopen).toEqual([{ instalmentId: "p1-2", sequence: 2, amountCents: 500, paidTo: 0 }]);
    expect(plan.updates[0]).toMatchObject({ owingBefore: 200 + 700 + 699, owingAfter: 700 + 700 + 699 });
  });

  it("tells look-alike orders apart by which instalments are still owed", () => {
    // Two identical $28 orders four days apart; the earlier one has more left
    // to pay, so it must take the longer chain even though the later one's
    // purchase date sits closer to that chain's implied start.
    const paidUpTo = (id: string, paidThrough: number, purchasedOn: string) =>
      order({
        id,
        purchasedOn,
        instalments: order({ id }).instalments.map((i) => ({ ...i, paidCents: i.sequence <= paidThrough ? i.principalCents : 0 })),
      });
    const threeLeft = paidUpTo("three", 1, "2026-09-01");
    const twoLeft = paidUpTo("two", 2, "2026-09-05");
    const plan = planUpcoming(
      [
        row("Glimmer Goods", "2 of 4", "2026-10-08", "7.00"),
        row("Glimmer Goods", "3 of 4", "2026-10-22", "7.00"),
        row("Glimmer Goods", "4 of 4", "2026-11-05", "6.99"),
        row("Glimmer Goods", "3 of 4", "2026-10-08", "7.00"),
        row("Glimmer Goods", "4 of 4", "2026-10-22", "6.99"),
      ],
      [threeLeft, twoLeft],
      options,
      TODAY,
    );
    const byId = Object.fromEntries(plan.updates.map((u) => [u.orderId, u]));
    expect(byId.three?.markPaid).toEqual([]);
    expect(byId.three?.reopen).toEqual([]);
    expect(byId.two?.markPaid).toEqual([]);
    expect(byId.two?.reopen).toEqual([]);
    expect(plan.creates).toEqual([]);
  });

  it("re-opens a settled order only when asked", () => {
    const settled = order({
      id: "s1",
      status: "settled",
      instalments: order({ id: "s1" }).instalments.map((i) => ({ ...i, paidCents: i.principalCents })),
    });
    const rows = [row("Glimmer Goods", "4 of 4", "2026-11-05", "6.99")];
    const reopened = planUpcoming(rows, [settled], options, TODAY);
    expect(reopened.updates[0]).toMatchObject({ orderId: "s1", wasSettled: true, owingBefore: 0, owingAfter: 699 });
    expect(reopened.updates[0]?.reopen).toEqual([{ instalmentId: "s1-4", sequence: 4, amountCents: 699, paidTo: 0 }]);
    expect(reopened.creates).toEqual([]);

    const kept = planUpcoming(rows, [settled], { ...options, reopenSettled: false }, TODAY);
    expect(kept.updates).toEqual([]);
    expect(kept.creates).toHaveLength(1);
  });

  it("creates an order for an unmatched chain, estimating what the export omits", () => {
    const plan = planUpcoming(
      [
        row("Brightwater In-Store", "2 of 4", "2026-10-08", "10.00"),
        row("Brightwater In-Store", "3 of 4", "2026-10-22", "10.00"),
        row("Brightwater In-Store", "4 of 4", "2026-11-05", "9.98"),
      ],
      [],
      options,
      TODAY,
    );
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0]).toMatchObject({
      merchant: "Brightwater In-Store",
      channel: "in_store",
      purchasedOn: "2026-09-10",
      totalAmountCents: 3998,
      instalmentCount: 4,
      owing: 2998,
      lines: [2, 3, 4],
    });
    expect(plan.creates[0]?.schedule).toEqual([
      { sequence: 1, dueOn: "2026-09-24", principalCents: 1000, paidCents: 1000 },
      { sequence: 2, dueOn: "2026-10-08", principalCents: 1000, paidCents: 0 },
      { sequence: 3, dueOn: "2026-10-22", principalCents: 1000, paidCents: 0 },
      { sequence: 4, dueOn: "2026-11-05", principalCents: 998, paidCents: 0 },
    ]);
    const skipped = planUpcoming([row("Brightwater In-Store", "2 of 4", "2026-10-08", "10.00")], [], { ...options, createUnmatched: false }, TODAY);
    expect(skipped.creates).toEqual([]);
    expect(skipped.chains).toHaveLength(1);
  });

  it("settles active orders the export no longer mentions, and leaves settled ones alone", () => {
    const missing = order({ id: "gone", merchant: "Other Shop", purchasedOn: "2026-08-01" });
    const done = order({
      id: "done",
      merchant: "Other Shop",
      status: "settled",
      instalments: order({ id: "done" }).instalments.map((i) => ({ ...i, paidCents: i.principalCents })),
    });
    const plan = planUpcoming([row("Glimmer Goods", "2 of 4", "2026-10-08", "7.00")], [order({ id: "o1" }), missing, done], options, TODAY);
    expect(plan.settles.map((s) => s.orderId)).toEqual(["gone"]);
    expect(plan.settles[0]?.markPaid.map((p) => p.sequence)).toEqual([2, 3, 4]);
    expect(plan.settles[0]?.markPaid[0]?.paidOn).toBe(TODAY);
    // o1 keeps only instalment 2 (700); "gone" is paid off; "done" stays settled.
    expect(plan.updates[0]?.markPaid.map((p) => p.sequence)).toEqual([3, 4]);
    expect(plan).toMatchObject({ owingBefore: 2099 * 2, owingAfter: 700 });

    const kept = planUpcoming([row("Glimmer Goods", "2 of 4", "2026-10-08", "7.00")], [order({ id: "o1" }), missing], { ...options, settleMissing: false }, TODAY);
    expect(kept.settles).toEqual([]);
    expect(kept.owingAfter).toBe(700 + 2099);
  });
});
