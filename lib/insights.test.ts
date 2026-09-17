import { describe, expect, it } from "vitest";
import { buildInsights, type InsightInstalment, type InsightOrder, type ProviderKind } from "./insights";
import { computeOrder } from "./ledger";

const TODAY = "2026-09-17";
const fmt = {
  money: (cents: number) => `$${(cents / 100).toFixed(2)}`,
  date: (iso: string) => iso,
};

let nextId = 0;

function instalment(overrides: Partial<InsightInstalment> = {}): InsightInstalment {
  nextId += 1;
  return {
    id: `i${nextId}`,
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

interface OrderOptions {
  provider?: { id: string; name: string; kind?: ProviderKind };
  purchasedAt?: string;
  totalAmountCents?: number;
  instalments: InsightInstalment[];
  refunds?: { amountCents: number }[];
  cancelled?: boolean;
}

function order({
  provider = { id: "p1", name: "Northwind Pay" },
  purchasedAt = "2026-09-01",
  totalAmountCents,
  instalments,
  refunds = [],
  cancelled = false,
}: OrderOptions): InsightOrder {
  nextId += 1;
  const total = totalAmountCents ?? instalments.reduce((s, i) => s + i.principalCents, 0);
  return {
    id: `o${nextId}`,
    merchant: "Glimmer Goods",
    purchasedAt: new Date(`${purchasedAt}T00:00:00Z`),
    totalAmountCents: total,
    instalmentCount: instalments.length,
    provider: { kind: "bnpl", ...provider },
    ledger: computeOrder({ totalAmountCents: total, instalments, refunds, cancelled }, TODAY),
  };
}

function payInFour(overrides: Partial<InsightInstalment>[] = []) {
  return [0, 1, 2, 3].map((index) =>
    instalment({
      sequence: index + 1,
      dueOn: `2026-10-${String(1 + index * 14).padStart(2, "0")}`,
      ...overrides[index],
    }),
  );
}

const ids = (insights: ReturnType<typeof buildInsights>) => insights.advice.map((a) => a.id);

describe("buildInsights totals", () => {
  it("returns zeros and no advice for an empty account", () => {
    const insights = buildInsights([], TODAY, fmt);
    expect(insights).toMatchObject({
      owed: 0,
      purchased: 0,
      feeRate: 0,
      clearBy: null,
      activeOrders: 0,
      totalOrders: 0,
      advice: [],
      providers: [],
    });
    expect(insights.months.map((m) => m.month)).toEqual(["2026-09", "2026-10", "2026-11"]);
  });

  it("keeps a decimal on small fee shares", () => {
    const o = order({
      totalAmountCents: 100000,
      instalments: payInFour([{ principalCents: 25000, paidCents: 25300, fees: [{ kind: "late", amountCents: 300 }] }]),
    });
    expect(buildInsights([o], TODAY, fmt).advice.find((a) => a.id === "late-fees")!.body).toContain("adding 0.3%");
  });

  it("splits fees by kind and counts waived amounts", () => {
    const o = order({
      instalments: payInFour([
        { paidCents: 3500, fees: [{ kind: "late", amountCents: 1000 }] },
        { paidCents: 2500, waivedCents: 800, fees: [{ kind: "late", amountCents: 800 }] },
        { fees: [{ kind: "establishment", amountCents: 300 }] },
        { fees: [{ kind: "other", amountCents: 50 }] },
      ]),
    });
    const insights = buildInsights([o], TODAY, fmt);
    expect(insights.fees).toEqual({
      total: 2150,
      late: 1800,
      establishment: 300,
      other: 50,
      waived: 800,
      onActive: 2150,
    });
    expect(insights.purchased).toBe(10000);
    expect(insights.paid).toBe(6000);
    expect(insights.feeRate).toBeCloseTo(0.215);
  });

  it("ignores cancelled orders but still counts them in the total", () => {
    const live = order({ instalments: payInFour() });
    const cancelled = order({
      cancelled: true,
      instalments: payInFour([{ fees: [{ kind: "late", amountCents: 900 }] }]),
    });
    const insights = buildInsights([live, cancelled], TODAY, fmt);
    expect(insights.totalOrders).toBe(2);
    expect(insights.activeOrders).toBe(1);
    expect(insights.fees.late).toBe(0);
    expect(insights.owed).toBe(10000);
  });

  it("finds the last due date across active orders", () => {
    const a = order({ instalments: payInFour() });
    const b = order({ instalments: [instalment({ dueOn: "2027-01-05" })] });
    const settled = order({ instalments: [instalment({ dueOn: "2028-01-01", paidCents: 2500 })] });
    expect(buildInsights([a, b, settled], TODAY, fmt).clearBy).toBe("2027-01-05");
    expect(buildInsights([settled], TODAY, fmt).clearBy).toBeNull();
  });

  it("buckets what is unpaid into the next three months, with overdue folded into this month", () => {
    const o = order({
      instalments: [
        instalment({ sequence: 1, dueOn: "2026-08-20" }),
        instalment({ sequence: 2, dueOn: "2026-09-25" }),
        instalment({ sequence: 3, dueOn: "2026-10-09", principalCents: 1000 }),
        instalment({ sequence: 4, dueOn: "2026-12-01" }),
      ],
    });
    expect(buildInsights([o], TODAY, fmt).months).toEqual([
      { month: "2026-09", total: 5000, count: 2 },
      { month: "2026-10", total: 1000, count: 1 },
      { month: "2026-11", total: 0, count: 0 },
    ]);
  });

  it("rolls the month window across a year boundary", () => {
    const o = order({ instalments: [instalment({ dueOn: "2027-02-10" })] });
    expect(buildInsights([o], "2026-12-15", fmt).months.map((m) => m.month)).toEqual([
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
  });

  it("ranks providers by what is owed, then by fees", () => {
    const small = order({
      provider: { id: "a", name: "Aster" },
      instalments: [instalment({ principalCents: 100 })],
    });
    const paidOffWithFees = order({
      provider: { id: "b", name: "Bramble" },
      instalments: [instalment({ paidCents: 3000, fees: [{ kind: "late", amountCents: 500 }] })],
    });
    const paidOffNoFees = order({
      provider: { id: "c", name: "Cinder" },
      instalments: [instalment({ paidCents: 2500 })],
    });
    const insights = buildInsights([paidOffNoFees, paidOffWithFees, small], TODAY, fmt);
    expect(insights.providers.map((p) => p.name)).toEqual(["Aster", "Bramble", "Cinder"]);
    expect(insights.providers[1]).toMatchObject({ activeOrders: 0, owed: 0, fees: 500, lateFees: 500 });
  });

  it("compares the last 90 days of purchases with the 90 before", () => {
    const recent = order({ purchasedAt: "2026-09-10", totalAmountCents: 4000, instalments: payInFour() });
    const edge = order({ purchasedAt: "2026-06-19", totalAmountCents: 1000, instalments: payInFour() });
    const prior = order({ purchasedAt: "2026-05-01", totalAmountCents: 8000, instalments: payInFour() });
    const ancient = order({ purchasedAt: "2025-01-01", totalAmountCents: 9999, instalments: payInFour() });
    const { trend } = buildInsights([recent, edge, prior, ancient], TODAY, fmt);
    expect(trend).toEqual({ recent: { count: 1, total: 4000 }, prior: { count: 2, total: 9000 } });
  });
});

describe("buildInsights advice", () => {
  it("flags overdue money first", () => {
    const o = order({
      instalments: [
        instalment({ sequence: 1, dueOn: "2026-09-01" }),
        instalment({ sequence: 2, dueOn: "2026-09-10", fees: [{ kind: "late", amountCents: 1000 }] }),
      ],
    });
    const insights = buildInsights([o], TODAY, fmt);
    expect(insights.overdue).toBe(6000);
    expect(insights.overdueCount).toBe(2);
    expect(insights.advice[0]).toMatchObject({
      id: "overdue",
      tone: "danger",
      title: "$60.00 is overdue",
      href: "/upcoming",
    });
    expect(insights.advice[0]!.body).toContain("2 payments");
  });

  it("explains late fees and mentions waivers when there have been any", () => {
    const withWaiver = order({
      instalments: payInFour([
        { paidCents: 3500, fees: [{ kind: "late", amountCents: 1000 }] },
        { paidCents: 2500, waivedCents: 1000, fees: [{ kind: "late", amountCents: 1000 }] },
      ]),
    });
    const advice = buildInsights([withWaiver], TODAY, fmt).advice.find((a) => a.id === "late-fees")!;
    expect(advice.title).toBe("Late fees have cost you $20.00");
    expect(advice.body).toContain("2 payments across 1 order");
    expect(advice.body).toContain("20%");
    expect(advice.body).toContain("$10.00 waived");

    const noWaiver = order({
      instalments: payInFour([{ paidCents: 3500, fees: [{ kind: "late", amountCents: 1000 }] }]),
    });
    expect(buildInsights([noWaiver], TODAY, fmt).advice.find((a) => a.id === "late-fees")!.body).not.toContain(
      "waived",
    );
  });

  it("names a provider that carries most of the late fees, but only when there is more than one", () => {
    const heavy = order({
      provider: { id: "h", name: "Harbourline Finance" },
      instalments: payInFour([{ paidCents: 4000, fees: [{ kind: "late", amountCents: 1500 }] }]),
    });
    const light = order({
      provider: { id: "l", name: "Lantern" },
      instalments: payInFour([{ paidCents: 3000, fees: [{ kind: "late", amountCents: 500 }] }]),
    });
    const both = buildInsights([heavy, light], TODAY, fmt);
    expect(both.advice.find((a) => a.id === "fee-heavy-provider")).toMatchObject({
      title: "Harbourline Finance accounts for 75% of your late fees",
      href: "/providers",
    });
    expect(ids(buildInsights([heavy], TODAY, fmt))).not.toContain("fee-heavy-provider");

    const even = order({
      provider: { id: "l", name: "Lantern" },
      instalments: payInFour([{ paidCents: 4000, fees: [{ kind: "late", amountCents: 1500 }] }]),
    });
    const evenlySplit = order({
      provider: { id: "m", name: "Marigold" },
      instalments: payInFour([{ paidCents: 4000, fees: [{ kind: "late", amountCents: 1500 }] }]),
    });
    const evenOrder = order({
      provider: { id: "n", name: "Nimbus" },
      instalments: payInFour([{ paidCents: 4000, fees: [{ kind: "late", amountCents: 1500 }] }]),
    });
    expect(ids(buildInsights([even, evenlySplit, evenOrder], TODAY, fmt))).not.toContain("fee-heavy-provider");
  });

  it("spots a week with three or more payments and picks the heaviest", () => {
    const a = order({ instalments: [instalment({ dueOn: "2026-09-20" }), instalment({ sequence: 2, dueOn: "2026-10-04" })] });
    const b = order({ instalments: [instalment({ dueOn: "2026-09-22" }), instalment({ sequence: 2, dueOn: "2026-10-06", principalCents: 9000 })] });
    const c = order({ instalments: [instalment({ dueOn: "2026-09-26" }), instalment({ sequence: 2, dueOn: "2026-10-10" })] });
    const crunch = buildInsights([a, b, c], TODAY, fmt).advice.find((x) => x.id === "crunch")!;
    expect(crunch.title).toBe("3 payments land between 2026-10-04 and 2026-10-10");
    expect(crunch.body).toContain("$140.00");
  });

  it("ignores payments outside the 60-day horizon, in the past, or fewer than three", () => {
    const overdue = order({ instalments: [instalment({ dueOn: "2026-09-01" })] });
    const two = order({ instalments: [instalment({ dueOn: "2026-09-20" }), instalment({ sequence: 2, dueOn: "2026-09-21" })] });
    const far = order({
      instalments: [
        instalment({ dueOn: "2027-01-01" }),
        instalment({ sequence: 2, dueOn: "2027-01-02" }),
        instalment({ sequence: 3, dueOn: "2027-01-03" }),
      ],
    });
    expect(ids(buildInsights([overdue, two, far], TODAY, fmt))).not.toContain("crunch");
  });

  it("suggests closing out orders with a single payment left", () => {
    const nearly = order({ instalments: payInFour([{ paidCents: 2500 }, { paidCents: 2500 }, { paidCents: 2500 }]) });
    const pendingOnly = order({ instalments: [instalment({ pendingCents: 2500 })] });
    const halfway = order({ instalments: payInFour([{ paidCents: 2500 }, { paidCents: 2500 }]) });
    const advice = buildInsights([nearly, pendingOnly, halfway], TODAY, fmt).advice.find((a) => a.id === "close-out")!;
    expect(advice.title).toBe("1 order is one payment from done");
    expect(advice.body).toContain("$25.00");
    expect(advice.href).toBe("/orders?status=active");

    const twoNearly = buildInsights([nearly, order({ instalments: payInFour([{ paidCents: 2500 }, { paidCents: 2500 }, { paidCents: 2500 }]) })], TODAY, fmt);
    expect(twoNearly.advice.find((a) => a.id === "close-out")!.title).toBe("2 orders are one payment from done");

    const single = order({ instalments: [instalment()] });
    expect(ids(buildInsights([single], TODAY, fmt))).not.toContain("close-out");
  });

  it("warns when active orders span three or more providers", () => {
    const orders = ["a", "b", "c"].map((id) =>
      order({ provider: { id, name: id.toUpperCase() }, instalments: [instalment()] }),
    );
    const settledElsewhere = order({ provider: { id: "d", name: "D" }, instalments: [instalment({ paidCents: 2500 })] });
    expect(buildInsights([...orders, settledElsewhere], TODAY, fmt).advice.find((a) => a.id === "many-providers")!.title).toBe(
      "You're juggling 3 providers at once",
    );
    expect(ids(buildInsights(orders.slice(0, 2), TODAY, fmt))).not.toContain("many-providers");
  });

  it("calls out spending that is up or down by a quarter, and stays quiet otherwise", () => {
    const prior = (total: number) => order({ purchasedAt: "2026-05-01", totalAmountCents: total, instalments: payInFour() });
    const recent = (total: number) => order({ purchasedAt: "2026-09-01", totalAmountCents: total, instalments: payInFour() });

    const up = buildInsights([prior(10000), recent(15000)], TODAY, fmt).advice.find((a) => a.id === "spending-up")!;
    expect(up.title).toBe("New instalment spending is up 50%");
    expect(up.body).toContain("$150.00 across 1 order");

    const down = buildInsights([prior(10000), recent(5000)], TODAY, fmt).advice.find((a) => a.id === "spending-down")!;
    expect(down.title).toBe("New instalment spending is down 50%");

    const flat = ids(buildInsights([prior(10000), recent(11000)], TODAY, fmt));
    expect(flat).not.toContain("spending-up");
    expect(flat).not.toContain("spending-down");

    const noPrior = ids(buildInsights([recent(11000)], TODAY, fmt));
    expect(noPrior).not.toContain("spending-up");
  });

  it("mentions pending money", () => {
    const o = order({ instalments: [instalment({ pendingCents: 1500 })] });
    expect(buildInsights([o], TODAY, fmt).advice.find((a) => a.id === "pending")).toMatchObject({
      tone: "info",
      title: "$15.00 is pending",
    });
  });

  it("congratulates a clear account and a fee-free history", () => {
    const settled = order({ instalments: [instalment({ paidCents: 2500 })] });
    const insights = buildInsights([settled], TODAY, fmt);
    expect(ids(insights)).toEqual(["all-clear", "no-late-fees"]);
    expect(insights.advice[1]!.body).toContain("1 order");

    const active = order({ instalments: [instalment()] });
    expect(ids(buildInsights([active], TODAY, fmt))).toEqual(["no-late-fees"]);
    expect(ids(buildInsights([], TODAY, fmt))).toEqual([]);
  });

  it("orders advice by urgency", () => {
    const o = order({
      instalments: [
        instalment({ sequence: 1, dueOn: "2026-09-01" }),
        instalment({ sequence: 2, dueOn: "2026-10-01", pendingCents: 2500 }),
        instalment({ sequence: 3, dueOn: "2026-10-15", paidCents: 3500, fees: [{ kind: "late", amountCents: 1000 }] }),
      ],
    });
    expect(ids(buildInsights([o], TODAY, fmt))).toEqual(["overdue", "late-fees", "pending"]);
  });
});
