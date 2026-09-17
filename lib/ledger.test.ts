import { describe, expect, it } from "vitest";
import {
  allocatePaid,
  computeInstalment,
  computeOrder,
  deriveOrderStatus,
  dueWithin,
  generateSchedule,
  overdueTotal,
  type InstalmentInput,
} from "./ledger";

const TODAY = "2026-09-17";

function instalment(overrides: Partial<InstalmentInput> = {}): InstalmentInput {
  return {
    sequence: 1,
    dueOn: "2026-10-01",
    principalCents: 2500,
    paidCents: 0,
    pendingCents: 0,
    waivedCents: 0,
    fees: [],
    ...overrides,
  };
}

describe("computeInstalment", () => {
  it("is upcoming when nothing is paid and it is not yet due", () => {
    expect(computeInstalment(instalment(), TODAY)).toEqual({
      feesTotal: 0,
      amountWithFees: 2500,
      amountOwed: 2500,
      amountPayable: 2500,
      state: "upcoming",
    });
  });

  it("is upcoming on the due date itself and overdue the day after", () => {
    expect(computeInstalment(instalment({ dueOn: TODAY }), TODAY).state).toBe("upcoming");
    expect(computeInstalment(instalment({ dueOn: "2026-09-16" }), TODAY).state).toBe(
      "overdue",
    );
  });

  it("adds fees to what is owed", () => {
    const result = computeInstalment(
      instalment({ fees: [{ amountCents: 1000 }, { amountCents: 425 }] }),
      TODAY,
    );
    expect(result.feesTotal).toBe(1425);
    expect(result.amountWithFees).toBe(3925);
    expect(result.amountOwed).toBe(3925);
  });

  it("is paid when paid plus waived covers principal and fees", () => {
    expect(
      computeInstalment(instalment({ paidCents: 2500 }), TODAY).state,
    ).toBe("paid");
    expect(
      computeInstalment(
        instalment({ paidCents: 2000, waivedCents: 500 }),
        TODAY,
      ).state,
    ).toBe("paid");
    expect(
      computeInstalment(
        instalment({ paidCents: 2500, fees: [{ amountCents: 1000 }] }),
        TODAY,
      ),
    ).toMatchObject({ amountOwed: 1000, state: "upcoming" });
  });

  it("clamps an over-payment to zero owed", () => {
    expect(computeInstalment(instalment({ paidCents: 9999 }), TODAY)).toMatchObject({
      amountOwed: 0,
      amountPayable: 0,
      state: "paid",
    });
  });

  it("is pending when in-flight money covers the whole balance", () => {
    expect(
      computeInstalment(instalment({ pendingCents: 2500 }), TODAY),
    ).toMatchObject({ amountOwed: 2500, amountPayable: 0, state: "pending" });
  });

  it("is not pending when in-flight money only covers part of it", () => {
    const partial = computeInstalment(instalment({ pendingCents: 1000 }), TODAY);
    expect(partial).toMatchObject({ amountPayable: 1500, state: "upcoming" });
    const partialOverdue = computeInstalment(
      instalment({ pendingCents: 1000, dueOn: "2026-01-01" }),
      TODAY,
    );
    expect(partialOverdue.state).toBe("overdue");
  });

  it("clamps payable when pending exceeds what is owed", () => {
    expect(
      computeInstalment(instalment({ pendingCents: 9000 }), TODAY).amountPayable,
    ).toBe(0);
  });
});

describe("computeOrder", () => {
  it("fully paid order with three late fees", () => {
    const order = {
      totalAmountCents: 9700,
      refunds: [],
      instalments: [
        instalment({ sequence: 1, dueOn: "2023-08-06", paidCents: 2425, principalCents: 2425 }),
        instalment({
          sequence: 2,
          dueOn: "2023-08-20",
          principalCents: 2425,
          paidCents: 3425,
          fees: [{ amountCents: 1000 }],
        }),
        instalment({
          sequence: 3,
          dueOn: "2023-09-03",
          principalCents: 2425,
          paidCents: 3425,
          fees: [{ amountCents: 1000 }],
        }),
        instalment({
          sequence: 4,
          dueOn: "2023-09-17",
          principalCents: 2425,
          paidCents: 2850,
          fees: [{ amountCents: 425 }],
        }),
      ],
    };
    const ledger = computeOrder(order, TODAY);
    expect(ledger).toMatchObject({
      totalPaid: 12125,
      totalFees: 2425,
      amountRefunded: 0,
      owedAmount: 0,
      pendingAmount: 0,
      owedWithoutPending: 0,
      totalAfterRefunds: 9700,
      trueCost: 12125,
      status: "settled",
      paidCount: 4,
      remainingCount: 0,
      nextDue: null,
    });
    expect(ledger.instalments.map((i) => i.state)).toEqual([
      "paid",
      "paid",
      "paid",
      "paid",
    ]);
  });

  it("part-refunded order", () => {
    const ledger = computeOrder(
      {
        totalAmountCents: 10000,
        refunds: [{ amountCents: 2500 }],
        instalments: [
          instalment({ sequence: 1, dueOn: "2026-08-01", paidCents: 2500 }),
          instalment({ sequence: 2, dueOn: "2026-08-15", paidCents: 2500 }),
          instalment({ sequence: 3, dueOn: "2026-08-29" }),
          instalment({ sequence: 4, dueOn: "2026-09-12" }),
        ],
      },
      TODAY,
    );
    expect(ledger).toMatchObject({
      totalPaid: 5000,
      amountRefunded: 2500,
      totalAfterRefunds: 7500,
      owedAmount: 5000,
      trueCost: 7500,
      status: "active",
      paidCount: 2,
      remainingCount: 2,
    });
    expect(ledger.instalments.map((i) => i.state)).toEqual([
      "paid",
      "paid",
      "overdue",
      "overdue",
    ]);
    expect(ledger.nextDue?.sequence).toBe(3);
  });

  it("pending payment is owed but not payable", () => {
    const ledger = computeOrder(
      {
        totalAmountCents: 5000,
        refunds: [],
        instalments: [
          instalment({ sequence: 1, dueOn: "2026-09-10", pendingCents: 2500 }),
          instalment({ sequence: 2, dueOn: "2026-09-24" }),
        ],
      },
      TODAY,
    );
    expect(ledger).toMatchObject({
      owedAmount: 5000,
      pendingAmount: 2500,
      owedWithoutPending: 2500,
      status: "active",
    });
    expect(ledger.instalments[0]?.state).toBe("pending");
    expect(ledger.nextDue?.sequence).toBe(1);
  });

  it("over-payment counts toward true cost and settles the order", () => {
    const ledger = computeOrder(
      {
        totalAmountCents: 5000,
        refunds: [],
        instalments: [
          instalment({ sequence: 1, dueOn: "2026-09-01", paidCents: 2500 }),
          instalment({ sequence: 2, dueOn: "2026-09-15", paidCents: 3000 }),
        ],
      },
      TODAY,
    );
    expect(ledger).toMatchObject({
      totalPaid: 5500,
      owedAmount: 0,
      trueCost: 5500,
      status: "settled",
    });
  });

  it("sorts instalments by sequence and picks the earliest unpaid as next due", () => {
    const ledger = computeOrder(
      {
        totalAmountCents: 7500,
        refunds: [],
        instalments: [
          instalment({ sequence: 3, dueOn: "2026-10-15" }),
          instalment({ sequence: 1, dueOn: "2026-09-17", paidCents: 2500 }),
          instalment({ sequence: 2, dueOn: "2026-10-01" }),
        ],
      },
      TODAY,
    );
    expect(ledger.instalments.map((i) => i.sequence)).toEqual([1, 2, 3]);
    expect(ledger.nextDue?.sequence).toBe(2);
  });

  it("keeps a cancelled order cancelled regardless of balance", () => {
    const ledger = computeOrder(
      {
        totalAmountCents: 2500,
        refunds: [],
        cancelled: true,
        instalments: [instalment({ paidCents: 2500 })],
      },
      TODAY,
    );
    expect(ledger.status).toBe("cancelled");
  });

  it("handles an order with no instalments", () => {
    expect(computeOrder({ totalAmountCents: 0, refunds: [], instalments: [] }, TODAY))
      .toMatchObject({ owedAmount: 0, status: "settled", nextDue: null });
  });
});

describe("deriveOrderStatus", () => {
  it("is active only while something is owed", () => {
    expect(deriveOrderStatus(1)).toBe("active");
    expect(deriveOrderStatus(0)).toBe("settled");
  });
});

describe("generateSchedule", () => {
  it("splits 120.75 into 30.19 x3 + 30.18", () => {
    expect(
      generateSchedule({ totalAmountCents: 12075, instalmentCount: 4, firstDueOn: "2026-08-26" }),
    ).toEqual([
      { sequence: 1, dueOn: "2026-08-26", principalCents: 3019 },
      { sequence: 2, dueOn: "2026-09-09", principalCents: 3019 },
      { sequence: 3, dueOn: "2026-09-23", principalCents: 3019 },
      { sequence: 4, dueOn: "2026-10-07", principalCents: 3018 },
    ]);
  });

  it("rounds half up and lets the last instalment absorb the difference", () => {
    const cents = (opts: { totalAmountCents: number }) =>
      generateSchedule({ ...opts, instalmentCount: 4, firstDueOn: "2026-01-01" }).map(
        (i) => i.principalCents,
      );
    expect(cents({ totalAmountCents: 125 })).toEqual([31, 31, 31, 32]);
    expect(cents({ totalAmountCents: 2298 })).toEqual([575, 575, 575, 573]);
    expect(cents({ totalAmountCents: 4000 })).toEqual([1000, 1000, 1000, 1000]);
    expect(cents({ totalAmountCents: 0 })).toEqual([0, 0, 0, 0]);
  });

  it("falls back to floor when rounding would make the last one negative", () => {
    expect(
      generateSchedule({ totalAmountCents: 2, instalmentCount: 4, firstDueOn: "2026-01-01" }).map(
        (i) => i.principalCents,
      ),
    ).toEqual([0, 0, 0, 2]);
  });

  it("supports a single instalment and custom intervals", () => {
    expect(
      generateSchedule({ totalAmountCents: 999, instalmentCount: 1, firstDueOn: "2026-01-01" }),
    ).toEqual([{ sequence: 1, dueOn: "2026-01-01", principalCents: 999 }]);
    expect(
      generateSchedule({
        totalAmountCents: 300,
        instalmentCount: 3,
        firstDueOn: "2026-01-31",
        intervalDays: 30,
      }).map((i) => i.dueOn),
    ).toEqual(["2026-01-31", "2026-03-02", "2026-04-01"]);
  });

  it("rejects invalid input", () => {
    expect(() =>
      generateSchedule({ totalAmountCents: -1, instalmentCount: 4, firstDueOn: "2026-01-01" }),
    ).toThrow(/non-negative/);
    expect(() =>
      generateSchedule({ totalAmountCents: 10.5, instalmentCount: 4, firstDueOn: "2026-01-01" }),
    ).toThrow(/non-negative integer/);
    expect(() =>
      generateSchedule({ totalAmountCents: 100, instalmentCount: 0, firstDueOn: "2026-01-01" }),
    ).toThrow(/at least 1/);
    expect(() =>
      generateSchedule({ totalAmountCents: 100, instalmentCount: 4, firstDueOn: "1/1/2026" }),
    ).toThrow(/YYYY-MM-DD/);
  });
});

describe("allocatePaid", () => {
  const principals = [575, 575, 575, 573];

  it("fills instalments in order", () => {
    expect(allocatePaid(principals, 0)).toEqual([0, 0, 0, 0]);
    expect(allocatePaid(principals, 575)).toEqual([575, 0, 0, 0]);
    expect(allocatePaid(principals, 1000)).toEqual([575, 425, 0, 0]);
    expect(allocatePaid(principals, 2298)).toEqual([575, 575, 575, 573]);
  });

  it("puts any excess on the last instalment", () => {
    expect(allocatePaid(principals, 2398)).toEqual([575, 575, 575, 673]);
    expect(allocatePaid([], 100)).toEqual([]);
  });

  it("rejects negative or fractional amounts", () => {
    expect(() => allocatePaid(principals, -1)).toThrow(/non-negative/);
    expect(() => allocatePaid(principals, 1.5)).toThrow(/non-negative integer/);
  });
});

describe("dueWithin / overdueTotal", () => {
  const ledger = computeOrder(
    {
      totalAmountCents: 10000,
      refunds: [],
      instalments: [
        instalment({ sequence: 1, dueOn: "2026-09-01" }), // overdue
        instalment({ sequence: 2, dueOn: "2026-09-25" }), // in 8 days
        instalment({ sequence: 3, dueOn: "2026-10-10" }), // in 23 days
        instalment({ sequence: 4, dueOn: "2026-11-30", paidCents: 2500 }),
      ],
    },
    TODAY,
  );

  it("includes overdue money in every bucket", () => {
    expect(dueWithin(ledger.instalments, TODAY, 15)).toBe(5000);
    expect(dueWithin(ledger.instalments, TODAY, 30)).toBe(7500);
    expect(dueWithin(ledger.instalments, TODAY, 60)).toBe(7500);
    expect(dueWithin(ledger.instalments, TODAY, 0)).toBe(2500);
  });

  it("sums only overdue instalments", () => {
    expect(overdueTotal(ledger.instalments)).toBe(2500);
  });
});
