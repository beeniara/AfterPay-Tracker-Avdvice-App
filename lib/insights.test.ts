import { describe, expect, it } from "vitest";
import { addDays } from "./dates";
import {
  buildInsights,
  type InsightInstalment,
  type InsightOrder,
  type OrderChannel,
  type ProviderKind,
} from "./insights";
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
  merchant?: string;
  channel?: OrderChannel;
  provider?: { id: string; name: string; kind?: ProviderKind };
  purchasedAt?: string;
  totalAmountCents?: number;
  instalments: InsightInstalment[];
  refunds?: { amountCents: number }[];
  cancelled?: boolean;
}

function order({
  merchant = "Glimmer Goods",
  channel = "online",
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
    merchant,
    channel,
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

describe("buildInsights order history", () => {
  it("lists the five biggest orders with their true cost", () => {
    const orders = [3000, 9000, 1000, 7000, 5000, 8000].map((total, i) =>
      order({
        merchant: `Shop ${total}`,
        purchasedAt: `2026-0${1 + i}-15`,
        totalAmountCents: total,
        instalments: payInFour([{ paidCents: 2500, fees: [{ kind: "late", amountCents: 100 }] }]),
      }),
    );
    const cancelled = order({ cancelled: true, totalAmountCents: 99999, instalments: payInFour() });
    const { biggestOrders } = buildInsights([...orders, cancelled], TODAY, fmt);
    expect(biggestOrders.map((o) => o.total)).toEqual([9000, 8000, 7000, 5000, 3000]);
    expect(biggestOrders[0]).toMatchObject({
      merchant: "Shop 9000",
      providerName: "Northwind Pay",
      purchasedOn: "2026-02-15",
      status: "active",
      trueCost: 10100,
      owed: 7600,
    });
  });

  it("breaks a tie on amount by the most recent purchase", () => {
    const older = order({ merchant: "Older", purchasedAt: "2026-01-01", totalAmountCents: 4000, instalments: payInFour() });
    const newer = order({ merchant: "Newer", purchasedAt: "2026-06-01", totalAmountCents: 4000, instalments: payInFour() });
    expect(buildInsights([older, newer], TODAY, fmt).biggestOrders.map((o) => o.merchant)).toEqual(["Newer", "Older"]);
  });

  it("ranks merchants by order count, then spend, and caps the list at eight", () => {
    const shop = (merchant: string, purchasedAt: string, total: number, extra: Partial<InsightInstalment>[] = []) =>
      order({ merchant, purchasedAt, totalAmountCents: total, instalments: payInFour(extra) });
    const orders = [
      shop("Cobalt", "2026-01-01", 1000),
      shop("Cobalt", "2026-05-01", 1000, [{ paidCents: 2500, fees: [{ kind: "late", amountCents: 700 }] }]),
      shop("Cobalt", "2026-08-01", 1000),
      shop("Fernway", "2026-03-01", 9000),
      shop("Fernway", "2026-04-01", 9000),
      shop("Oakleaf", "2026-02-01", 20000),
      ...Array.from({ length: 7 }, (_, i) => shop(`Tiny ${i}`, "2026-07-01", 100 + i)),
    ];
    const { merchants } = buildInsights(orders, TODAY, fmt);
    expect(merchants).toHaveLength(8);
    expect(merchants.slice(0, 3).map((m) => m.name)).toEqual(["Cobalt", "Fernway", "Oakleaf"]);
    expect(merchants[0]).toMatchObject({
      orders: 3,
      activeOrders: 3,
      spent: 3000,
      fees: 700,
      lateFees: 700,
      lastPurchasedOn: "2026-08-01",
    });
  });

  it("counts purchases per month for the last twelve months", () => {
    const orders = [
      order({ purchasedAt: "2025-09-30", totalAmountCents: 1000, instalments: payInFour() }),
      order({ purchasedAt: "2025-10-01", totalAmountCents: 2000, instalments: payInFour() }),
      order({ purchasedAt: "2026-09-16", totalAmountCents: 3000, instalments: payInFour() }),
      order({ purchasedAt: "2026-09-17", totalAmountCents: 4000, instalments: payInFour() }),
    ];
    const { history } = buildInsights(orders, TODAY, fmt);
    expect(history).toHaveLength(12);
    expect(history[0]).toEqual({ month: "2025-10", count: 1, total: 2000 });
    expect(history[11]).toEqual({ month: "2026-09", count: 2, total: 7000 });
    expect(history.slice(1, 11).every((m) => m.count === 0)).toBe(true);
  });

  it("reports the average order, refunds and the online / in-store split", () => {
    const orders = [
      order({ channel: "online", totalAmountCents: 10000, instalments: payInFour(), refunds: [{ amountCents: 2000 }] }),
      order({ channel: "in_store", totalAmountCents: 5000, instalments: payInFour(), refunds: [{ amountCents: 500 }, { amountCents: 500 }] }),
      order({ channel: "in_store", totalAmountCents: 3000, instalments: payInFour() }),
    ];
    const insights = buildInsights(orders, TODAY, fmt);
    expect(insights.averageOrder).toBe(5000);
    expect(insights.refunded).toBe(3000);
    expect(insights.refundedOrders).toBe(2);
    expect(insights.channels).toEqual({
      online: { count: 1, total: 10000 },
      inStore: { count: 2, total: 8000 },
    });
    expect(buildInsights([], TODAY, fmt).averageOrder).toBe(0);
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

  it("says 'on' when every payment in the crunch lands the same day, and names a sole collector", () => {
    const sameDay = Array.from({ length: 3 }, () =>
      order({
        provider: { id: "cycle", name: "Tidewater Instalments" },
        instalments: [instalment({ dueOn: "2026-09-24" })],
      }),
    );
    const advice = buildInsights(sameDay, TODAY, fmt).advice.find((a) => a.id === "crunch")!;
    expect(advice.title).toBe("3 payments land on 2026-09-24");
    expect(advice.body).toContain("$75.00 in a single day");
    expect(advice.body).toContain("Tidewater Instalments collects everything on one day");

    const mixed = [
      ...sameDay.slice(0, 2),
      order({ provider: { id: "other", name: "Quartz Pay" }, instalments: [instalment({ dueOn: "2026-09-26" })] }),
    ];
    const mixedAdvice = buildInsights(mixed, TODAY, fmt).advice.find((a) => a.id === "crunch")!;
    expect(mixedAdvice.title).toBe("3 payments land between 2026-09-24 and 2026-09-26");
    expect(mixedAdvice.body).not.toContain("collects everything");
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

  it("points out an order that dominates what is owed, only when there is more than one", () => {
    const big = order({ merchant: "Pixel & Pine", instalments: payInFour([{ principalCents: 40000 }]) });
    const small = order({ merchant: "Fernway", instalments: [instalment({ principalCents: 1000 })] });
    const advice = buildInsights([big, small], TODAY, fmt).advice.find((a) => a.id === "big-order-share")!;
    expect(advice.title).toBe("One order is 98% of what you owe");
    expect(advice.body).toContain("Pixel & Pine still has $475.00 to go across 4 payments");
    expect(advice.href).toBe(`/orders/${big.id}`);

    expect(ids(buildInsights([big], TODAY, fmt))).not.toContain("big-order-share");
    const even = order({ instalments: payInFour([{ principalCents: 40000 }]) });
    expect(ids(buildInsights([big, even], TODAY, fmt))).not.toContain("big-order-share");
  });

  it("notices a shop you keep going back to within the last year", () => {
    const cobalt = (purchasedAt: string) =>
      order({ merchant: "Cobalt Kitchenware", purchasedAt, totalAmountCents: 6000, instalments: payInFour() });
    const advice = buildInsights(
      [cobalt("2026-01-10"), cobalt("2026-04-10"), cobalt("2026-08-10"), cobalt("2025-01-01")],
      TODAY,
      fmt,
    ).advice.find((a) => a.id === "repeat-merchant")!;
    expect(advice.title).toBe("3 orders with Cobalt Kitchenware in the last year");
    expect(advice.body).toContain("$180.00, 100% of everything");
    expect(advice.body).toContain("free up about $7.50 a month");
    expect(advice.href).toBe("/orders?merchant=Cobalt%20Kitchenware");

    expect(ids(buildInsights([cobalt("2026-01-10"), cobalt("2026-04-10")], TODAY, fmt))).not.toContain("repeat-merchant");
  });

  it("flags several small purchases put on instalments in the last year", () => {
    const tiny = (purchasedAt: string, total = 2000) =>
      order({ purchasedAt, totalAmountCents: total, instalments: payInFour([{ principalCents: total }]) });
    const advice = buildInsights(
      [tiny("2026-02-01"), tiny("2026-05-01", 4999), tiny("2026-09-01"), tiny("2025-02-01"), tiny("2026-06-01", 5000)],
      TODAY,
      fmt,
    ).advice.find((a) => a.id === "small-orders")!;
    expect(advice.title).toBe("3 purchases under $50.00 went on instalments");
    expect(advice.body).toContain("$89.99, about $7.50 a month");

    expect(ids(buildInsights([tiny("2026-02-01"), tiny("2026-05-01")], TODAY, fmt))).not.toContain("small-orders");
  });

  it("reminds you to check refunds landed on the plan", () => {
    const o = order({ totalAmountCents: 10000, instalments: payInFour(), refunds: [{ amountCents: 2500 }] });
    expect(buildInsights([o], TODAY, fmt).advice.find((a) => a.id === "refunds")).toMatchObject({
      tone: "info",
      title: "$25.00 refunded across 1 order",
      href: "/orders",
    });
  });

  it("warns about the pace of new orders and projects it over a year", () => {
    const quick = Array.from({ length: 26 }, (_, i) =>
      order({ purchasedAt: addDays(TODAY, -i * 3), totalAmountCents: 3000, instalments: payInFour() }),
    );
    const insights = buildInsights(quick, TODAY, fmt);
    expect(insights.habits.ordersPerWeek).toBe(2);
    expect(insights.habits.spendPerWeek).toBe(6067);
    expect(insights.habits.projectedYear).toBe(316333);
    const advice = insights.advice.find((a) => a.id === "order-pace")!;
    expect(advice.title).toBe("About 2 new orders a week");
    expect(advice.body).toContain("$60.67 a week");
    expect(advice.body).toContain("$3163.33 over a year");

    expect(ids(buildInsights(quick.slice(0, 20), TODAY, fmt))).not.toContain("order-pace");
  });

  it("counts an unbroken run of weeks with an order", () => {
    const weekly = (weeks: number) =>
      Array.from({ length: weeks }, (_, i) =>
        order({ purchasedAt: addDays(TODAY, -(i * 7 + 3)), instalments: payInFour() }),
      );
    const insights = buildInsights(weekly(8), TODAY, fmt);
    expect(insights.habits.weeklyStreak).toBe(8);
    expect(insights.advice.find((a) => a.id === "order-streak")!.title).toBe(
      "A new order every week for 8 weeks straight",
    );

    const gap = buildInsights([...weekly(3), order({ purchasedAt: "2026-07-01", instalments: payInFour() })], TODAY, fmt);
    expect(gap.habits.weeklyStreak).toBe(3);
    expect(ids(gap)).not.toContain("order-streak");
    expect(buildInsights([], TODAY, fmt).habits.weeklyStreak).toBe(0);
  });

  it("compares the last twelve months with the twelve before", () => {
    const at = (purchasedAt: string, total: number) => order({ purchasedAt, totalAmountCents: total, instalments: payInFour() });
    const up = buildInsights([at("2025-03-01", 10000), at("2026-03-01", 15000)], TODAY, fmt);
    expect(up.habits.lastYear).toEqual({ count: 1, total: 15000 });
    expect(up.habits.priorYear).toEqual({ count: 1, total: 10000 });
    expect(up.advice.find((a) => a.id === "year-up")!.title).toBe("50% more on instalments than the year before");

    const down = buildInsights([at("2025-03-01", 10000), at("2026-03-01", 5000)], TODAY, fmt);
    expect(down.advice.find((a) => a.id === "year-down")!.title).toBe("50% less on instalments than the year before");

    const flat = ids(buildInsights([at("2025-03-01", 10000), at("2026-03-01", 11000)], TODAY, fmt));
    expect(flat).not.toContain("year-up");
    expect(flat).not.toContain("year-down");
  });

  it("finds days with more than one order and the busiest of them", () => {
    const at = (purchasedAt: string, total = 2000) => order({ purchasedAt, totalAmountCents: total, instalments: payInFour() });
    const doubles = Array.from({ length: 10 }, (_, i) => [at(`2026-05-${String(i + 1).padStart(2, "0")}`), at(`2026-05-${String(i + 1).padStart(2, "0")}`)]).flat();
    const triple = [at("2026-06-20", 1000), at("2026-06-20", 1000), at("2026-06-20", 9000)];
    const insights = buildInsights([...doubles, ...triple, at("2025-01-01"), at("2025-01-01")], TODAY, fmt);
    expect(insights.habits.multiOrderDays).toBe(11);
    expect(insights.habits.busiestDay).toEqual({ date: "2026-06-20", count: 3, total: 11000 });
    const advice = insights.advice.find((a) => a.id === "multi-order-days")!;
    expect(advice.title).toBe("11 days with more than one order");
    expect(advice.body).toContain("2026-06-20: 3 orders for $110.00");

    const few = buildInsights(doubles.slice(0, 4), TODAY, fmt);
    expect(few.habits.multiOrderDays).toBe(2);
    expect(ids(few)).not.toContain("multi-order-days");
    expect(buildInsights([at("2026-05-01")], TODAY, fmt).habits.busiestDay).toBeNull();
  });

  it("notices weekend-heavy ordering once there are enough orders", () => {
    const at = (purchasedAt: string) => order({ purchasedAt, instalments: payInFour() });
    const fridays = ["2026-09-04", "2026-09-11", "2026-08-28", "2026-08-21", "2026-08-14", "2026-08-07"]; // Fridays
    const sunday = ["2026-09-06"];
    const weekdays = ["2026-09-01", "2026-09-02", "2026-09-03"]; // Tue-Thu
    const insights = buildInsights([...fridays, ...sunday, ...weekdays].map(at), TODAY, fmt);
    expect(insights.habits.weekendShare).toBeCloseTo(0.7);
    expect(insights.advice.find((a) => a.id === "weekend-orders")!.title).toBe("70% of your orders are placed Friday to Sunday");

    expect(ids(buildInsights([...fridays, ...sunday].map(at), TODAY, fmt))).not.toContain("weekend-orders");
    expect(ids(buildInsights([...fridays, ...weekdays, ...weekdays, "2026-09-08"].map(at), TODAY, fmt))).not.toContain("weekend-orders");
  });

  it("points out a provider holding most of what is owed", () => {
    const big = order({ provider: { id: "t", name: "Tidewater Instalments" }, instalments: payInFour([{ principalCents: 30000 }]) });
    const small = order({ provider: { id: "q", name: "Quartz Pay" }, instalments: [instalment({ principalCents: 1000 })] });
    const advice = buildInsights([big, small], TODAY, fmt).advice.find((a) => a.id === "provider-share")!;
    expect(advice.title).toBe("97% of what you owe is with Tidewater Instalments");
    expect(advice.href).toBe("/providers");

    expect(ids(buildInsights([big], TODAY, fmt))).not.toContain("provider-share");
    const even = order({ provider: { id: "q", name: "Quartz Pay" }, instalments: payInFour([{ principalCents: 30000 }]) });
    expect(ids(buildInsights([big, even], TODAY, fmt))).not.toContain("provider-share");
  });

  it("celebrates a quiet spell of thirty days or more", () => {
    const old = order({ purchasedAt: "2026-08-01", instalments: payInFour() });
    const insights = buildInsights([old], TODAY, fmt);
    expect(insights.habits.daysSinceLastOrder).toBe(47);
    expect(insights.advice.find((a) => a.id === "quiet-spell")!.title).toBe("47 days since your last order");

    const recent = order({ purchasedAt: "2026-09-10", instalments: payInFour() });
    const both = buildInsights([old, recent], TODAY, fmt);
    expect(both.habits.daysSinceLastOrder).toBe(7);
    expect(ids(both)).not.toContain("quiet-spell");
    expect(buildInsights([], TODAY, fmt).habits.daysSinceLastOrder).toBeNull();
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
