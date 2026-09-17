import { addDays, daysBetween } from "@/lib/dates";
import type { InstalmentInput, OrderLedger } from "@/lib/ledger";

export type FeeKind = "late" | "establishment" | "other";
export type ProviderKind = "bnpl" | "store_finance" | "loan" | "other";

export interface InsightFee {
  kind: FeeKind;
  amountCents: number;
}

export interface InsightInstalment extends InstalmentInput {
  id: string;
  fees: readonly InsightFee[];
}

export type OrderChannel = "online" | "in_store";

export interface InsightOrder {
  id: string;
  merchant: string;
  channel: OrderChannel;
  purchasedAt: Date;
  totalAmountCents: number;
  instalmentCount: number;
  provider: { id: string; name: string; kind: ProviderKind };
  ledger: OrderLedger<InsightInstalment>;
}

export type AdviceTone = "danger" | "warning" | "info" | "success";

export interface Advice {
  id: string;
  tone: AdviceTone;
  title: string;
  body: string;
  href?: string;
  cta?: string;
}

export interface FeeBreakdown {
  total: number;
  late: number;
  establishment: number;
  other: number;
  waived: number;
  onActive: number;
}

export interface MonthCommitment {
  month: string;
  total: number;
  count: number;
}

export interface ProviderInsight {
  id: string;
  name: string;
  kind: ProviderKind;
  activeOrders: number;
  owed: number;
  fees: number;
  lateFees: number;
}

export interface SpendWindow {
  count: number;
  total: number;
}

export interface OrderHighlight {
  id: string;
  merchant: string;
  providerName: string;
  purchasedOn: string;
  status: OrderLedger["status"];
  total: number;
  trueCost: number;
  owed: number;
}

export interface MerchantInsight {
  name: string;
  orders: number;
  activeOrders: number;
  spent: number;
  fees: number;
  lateFees: number;
  lastPurchasedOn: string;
}

export interface MonthHistory {
  month: string;
  count: number;
  total: number;
}

export interface ChannelSplit {
  online: SpendWindow;
  inStore: SpendWindow;
}

export interface Insights {
  owed: number;
  owedWithoutPending: number;
  pending: number;
  overdue: number;
  overdueCount: number;
  activeOrders: number;
  settledOrders: number;
  totalOrders: number;
  purchased: number;
  paid: number;
  fees: FeeBreakdown;
  feeRate: number;
  clearBy: string | null;
  months: MonthCommitment[];
  providers: ProviderInsight[];
  trend: { recent: SpendWindow; prior: SpendWindow };
  biggestOrders: OrderHighlight[];
  merchants: MerchantInsight[];
  history: MonthHistory[];
  averageOrder: number;
  refunded: number;
  refundedOrders: number;
  channels: ChannelSplit;
  habits: Habits;
  advice: Advice[];
}

export interface BusiestDay {
  date: string;
  count: number;
  total: number;
}

export interface Habits {
  ordersPerWeek: number;
  spendPerWeek: number;
  projectedYear: number;
  weekendShare: number;
  multiOrderDays: number;
  busiestDay: BusiestDay | null;
  weeklyStreak: number;
  daysSinceLastOrder: number | null;
  lastYear: SpendWindow;
  priorYear: SpendWindow;
}

export interface InsightFormatters {
  money: (cents: number) => string;
  date: (iso: string) => string;
}

const TONE_RANK: Record<AdviceTone, number> = { danger: 0, warning: 1, info: 2, success: 3 };
const CRUNCH_WINDOW_DAYS = 7;
const CRUNCH_HORIZON_DAYS = 60;
const CRUNCH_MIN_PAYMENTS = 3;
const TREND_WINDOW_DAYS = 90;
const TREND_THRESHOLD = 0.25;
const MANY_PROVIDERS = 3;
const HIGHLIGHT_COUNT = 5;
const MERCHANT_COUNT = 8;
const HISTORY_MONTHS = 12;
const YEAR_DAYS = 365;
const REPEAT_MERCHANT_ORDERS = 3;
const SMALL_ORDER_CENTS = 5000;
const SMALL_ORDER_COUNT = 3;
const BIG_ORDER_SHARE = 0.5;
const WEEK_DAYS = 7;
const FREQUENT_ORDERS_PER_WEEK = 2;
const STREAK_WEEKS = 8;
const MULTI_ORDER_DAYS = 10;
const WEEKEND_SHARE = 0.5;
const WEEKEND_MIN_ORDERS = 10;
const QUIET_SPELL_DAYS = 30;
const PROVIDER_SHARE = 0.75;

function oneDecimal(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function isWeekend(iso: string): boolean {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day === 5 || day === 6 || day === 0;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function percent(ratio: number): string {
  const value = ratio * 100;
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)}%`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function addMonths(yearMonth: string, months: number): string {
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(5, 7)) - 1 + months;
  const date = new Date(Date.UTC(year, month, 1));
  return date.toISOString().slice(0, 7);
}

function purchasedOn(order: InsightOrder): string {
  return order.purchasedAt.toISOString().slice(0, 10);
}

function byDateDesc(a: string, b: string): number {
  return a < b ? 1 : a > b ? -1 : 0;
}

function feesOf(order: InsightOrder, kind?: FeeKind): number {
  return sum(
    order.ledger.instalments.flatMap((i) =>
      i.fees.filter((f) => kind === undefined || f.kind === kind).map((f) => f.amountCents),
    ),
  );
}

interface Crunch<T> {
  from: string;
  to: string;
  total: number;
  items: T[];
}

function findCrunch<T extends { dueOn: string; amountOwed: number }>(
  unpaid: readonly T[],
  today: string,
): Crunch<T> | null {
  const horizon = addDays(today, CRUNCH_HORIZON_DAYS);
  const ahead = unpaid
    .filter((i) => i.dueOn >= today && i.dueOn <= horizon)
    .sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0));

  let best: Crunch<T> | null = null;
  for (let start = 0; start < ahead.length; start += 1) {
    const from = ahead[start]!.dueOn;
    const to = addDays(from, CRUNCH_WINDOW_DAYS - 1);
    const items = ahead.slice(start).filter((i) => i.dueOn <= to);
    if (items.length < CRUNCH_MIN_PAYMENTS) continue;
    const total = sum(items.map((i) => i.amountOwed));
    if (best === null || total > best.total) {
      best = { from, to: items[items.length - 1]!.dueOn, total, items };
    }
  }
  return best;
}

export function buildInsights(
  orders: readonly InsightOrder[],
  today: string,
  fmt: InsightFormatters,
): Insights {
  const live = orders.filter((o) => o.ledger.status !== "cancelled");
  const active = live.filter((o) => o.ledger.status === "active");
  const settled = live.filter((o) => o.ledger.status === "settled");
  const activeInstalments = active.flatMap((o) => o.ledger.instalments);
  const unpaid = activeInstalments.filter((i) => i.state !== "paid");
  const unpaidWithOrder = active.flatMap((o) =>
    o.ledger.instalments.filter((i) => i.state !== "paid").map((i) => ({ ...i, order: o })),
  );
  const overdueInstalments = activeInstalments.filter((i) => i.state === "overdue");

  const owed = sum(active.map((o) => o.ledger.owedAmount));
  const owedWithoutPending = sum(active.map((o) => o.ledger.owedWithoutPending));
  const pending = sum(active.map((o) => o.ledger.pendingAmount));
  const overdue = sum(overdueInstalments.map((i) => i.amountOwed));
  const purchased = sum(live.map((o) => o.ledger.totalAfterRefunds));
  const paid = sum(live.map((o) => o.ledger.totalPaid));

  const fees: FeeBreakdown = {
    total: sum(live.map((o) => o.ledger.totalFees)),
    late: sum(live.map((o) => feesOf(o, "late"))),
    establishment: sum(live.map((o) => feesOf(o, "establishment"))),
    other: sum(live.map((o) => feesOf(o, "other"))),
    waived: sum(live.flatMap((o) => o.ledger.instalments.map((i) => i.waivedCents))),
    onActive: sum(active.map((o) => o.ledger.totalFees)),
  };
  const feeRate = purchased > 0 ? fees.total / purchased : 0;

  const clearBy = unpaid.reduce<string | null>(
    (latest, i) => (latest === null || i.dueOn > latest ? i.dueOn : latest),
    null,
  );

  const thisMonth = today.slice(0, 7);
  const months: MonthCommitment[] = [0, 1, 2].map((offset) => {
    const month = addMonths(thisMonth, offset);
    const mine = unpaid.filter((i) =>
      offset === 0 ? i.dueOn.slice(0, 7) <= month : i.dueOn.slice(0, 7) === month,
    );
    return { month, total: sum(mine.map((i) => i.amountOwed)), count: mine.length };
  });

  const byProvider = new Map<string, ProviderInsight>();
  for (const o of live) {
    const entry = byProvider.get(o.provider.id) ?? {
      id: o.provider.id,
      name: o.provider.name,
      kind: o.provider.kind,
      activeOrders: 0,
      owed: 0,
      fees: 0,
      lateFees: 0,
    };
    if (o.ledger.status === "active") {
      entry.activeOrders += 1;
      entry.owed += o.ledger.owedAmount;
    }
    entry.fees += o.ledger.totalFees;
    entry.lateFees += feesOf(o, "late");
    byProvider.set(o.provider.id, entry);
  }
  const providers = [...byProvider.values()].sort(
    (a, b) => b.owed - a.owed || b.fees - a.fees || a.name.localeCompare(b.name),
  );

  const ageOf = (o: InsightOrder) => daysBetween(purchasedOn(o), today);
  const spend = (mine: readonly InsightOrder[]): SpendWindow => ({
    count: mine.length,
    total: sum(mine.map((o) => o.totalAmountCents)),
  });
  const within = (from: number, to: number) =>
    live.filter((o) => {
      const age = ageOf(o);
      return age >= from && age < to;
    });
  const trend = {
    recent: spend(within(0, TREND_WINDOW_DAYS)),
    prior: spend(within(TREND_WINDOW_DAYS, TREND_WINDOW_DAYS * 2)),
  };
  const lastYear = within(0, YEAR_DAYS);

  const biggestOrders: OrderHighlight[] = [...live]
    .sort((a, b) => b.totalAmountCents - a.totalAmountCents || byDateDesc(purchasedOn(a), purchasedOn(b)))
    .slice(0, HIGHLIGHT_COUNT)
    .map((o) => ({
      id: o.id,
      merchant: o.merchant,
      providerName: o.provider.name,
      purchasedOn: purchasedOn(o),
      status: o.ledger.status,
      total: o.totalAmountCents,
      trueCost: o.ledger.trueCost,
      owed: o.ledger.owedAmount,
    }));

  const byMerchant = new Map<string, MerchantInsight>();
  for (const o of live) {
    const entry = byMerchant.get(o.merchant) ?? {
      name: o.merchant,
      orders: 0,
      activeOrders: 0,
      spent: 0,
      fees: 0,
      lateFees: 0,
      lastPurchasedOn: purchasedOn(o),
    };
    entry.orders += 1;
    if (o.ledger.status === "active") entry.activeOrders += 1;
    entry.spent += o.ledger.totalAfterRefunds;
    entry.fees += o.ledger.totalFees;
    entry.lateFees += feesOf(o, "late");
    if (purchasedOn(o) > entry.lastPurchasedOn) entry.lastPurchasedOn = purchasedOn(o);
    byMerchant.set(o.merchant, entry);
  }
  const merchants = [...byMerchant.values()]
    .sort((a, b) => b.orders - a.orders || b.spent - a.spent || a.name.localeCompare(b.name))
    .slice(0, MERCHANT_COUNT);

  const history: MonthHistory[] = Array.from({ length: HISTORY_MONTHS }, (_, i) => {
    const month = addMonths(thisMonth, i - (HISTORY_MONTHS - 1));
    const mine = live.filter((o) => purchasedOn(o).slice(0, 7) === month);
    return { month, count: mine.length, total: sum(mine.map((o) => o.totalAmountCents)) };
  });

  const averageOrder = live.length > 0 ? Math.round(purchased / live.length) : 0;
  const refundedOrdersList = live.filter((o) => o.ledger.amountRefunded > 0);
  const refunded = sum(refundedOrdersList.map((o) => o.ledger.amountRefunded));
  const channels: ChannelSplit = {
    online: spend(live.filter((o) => o.channel === "online")),
    inStore: spend(live.filter((o) => o.channel === "in_store")),
  };

  const weeksInTrend = TREND_WINDOW_DAYS / WEEK_DAYS;
  const byDay = new Map<string, InsightOrder[]>();
  for (const o of lastYear) byDay.set(purchasedOn(o), [...(byDay.get(purchasedOn(o)) ?? []), o]);
  const busiestDay = [...byDay.entries()]
    .map(([date, mine]) => ({ date, count: mine.length, total: sum(mine.map((o) => o.totalAmountCents)) }))
    .sort((a, b) => b.count - a.count || b.total - a.total || byDateDesc(a.date, b.date))[0];
  const weeksWithOrders = new Set(live.map((o) => Math.floor(ageOf(o) / WEEK_DAYS)));
  let weeklyStreak = 0;
  while (weeksWithOrders.has(weeklyStreak)) weeklyStreak += 1;
  const habits: Habits = {
    ordersPerWeek: Math.round((trend.recent.count / weeksInTrend) * 10) / 10,
    spendPerWeek: Math.round(trend.recent.total / weeksInTrend),
    projectedYear: Math.round((trend.recent.total * YEAR_DAYS) / TREND_WINDOW_DAYS),
    weekendShare: lastYear.length > 0 ? lastYear.filter((o) => isWeekend(purchasedOn(o))).length / lastYear.length : 0,
    multiOrderDays: [...byDay.values()].filter((mine) => mine.length >= 2).length,
    busiestDay: busiestDay && busiestDay.count >= 2 ? busiestDay : null,
    weeklyStreak,
    daysSinceLastOrder: live.length > 0 ? Math.min(...live.map(ageOf)) : null,
    lastYear: spend(lastYear),
    priorYear: spend(within(YEAR_DAYS, YEAR_DAYS * 2)),
  };

  const advice: Advice[] = [];
  const { money, date } = fmt;

  if (overdue > 0) {
    advice.push({
      id: "overdue",
      tone: "danger",
      title: `${money(overdue)} is overdue`,
      body: `${plural(overdueInstalments.length, "payment")} past the due date. Every day it sits there is a chance of another late fee, so clear it before anything else.`,
      href: "/upcoming",
      cta: "See what's overdue",
    });
  }

  if (fees.late > 0) {
    const lateInstalments = live.flatMap((o) =>
      o.ledger.instalments.filter((i) => i.fees.some((f) => f.kind === "late")),
    ).length;
    const lateOrders = live.filter((o) => feesOf(o, "late") > 0).length;
    const waived = fees.waived > 0 ? ` You've had ${money(fees.waived)} waived before, so it's always worth asking.` : "";
    advice.push({
      id: "late-fees",
      tone: "warning",
      title: `Late fees have cost you ${money(fees.late)}`,
      body: `${plural(lateInstalments, "payment")} across ${plural(lateOrders, "order")} went late, adding ${percent(fees.late / Math.max(purchased, 1))} on top of what you bought. Late fees are the only cost of a pay-in-4 plan, so a reminder two days before each due date is the biggest saving on offer here.${waived}`,
      href: "/upcoming",
      cta: "Check due dates",
    });
  }

  const feeProviders = providers.filter((p) => p.lateFees > 0);
  if (fees.late > 0 && providers.length > 1) {
    const top = feeProviders[0]!;
    const share = top.lateFees / fees.late;
    if (share >= 0.5) {
      advice.push({
        id: "fee-heavy-provider",
        tone: "warning",
        title: `${top.name} accounts for ${percent(share)} of your late fees`,
        body: `Their collection days may not line up with when you get paid. Ask whether the payment day can move, or favour a provider that hasn't cost you anything.`,
        href: "/providers",
        cta: "See providers",
      });
    }
  }

  const crunch = findCrunch(unpaidWithOrder, today);
  if (crunch) {
    const sameDay = crunch.from === crunch.to;
    const crunchProviders = new Set(crunch.items.map((i) => i.order.provider.name));
    const collector =
      crunchProviders.size === 1
        ? ` ${[...crunchProviders][0]} collects everything on one day, so one short balance can fail ${sameDay ? "all of them" : "several"} at once.`
        : "";
    advice.push({
      id: "crunch",
      tone: "warning",
      title: sameDay
        ? `${plural(crunch.items.length, "payment")} land on ${date(crunch.from)}`
        : `${plural(crunch.items.length, "payment")} land between ${date(crunch.from)} and ${date(crunch.to)}`,
      body: `That's ${money(crunch.total)} ${sameDay ? "in a single day" : "inside one week"}. Make sure the money is sitting in the account beforehand; a failed collection is how most late fees start.${collector}`,
      href: "/upcoming",
      cta: "See upcoming",
    });
  }

  if (habits.ordersPerWeek >= FREQUENT_ORDERS_PER_WEEK) {
    advice.push({
      id: "order-pace",
      tone: "warning",
      title: `About ${oneDecimal(habits.ordersPerWeek)} new orders a week`,
      body: `Over the last 90 days that's ${money(habits.spendPerWeek)} a week going onto instalment plans, about ${money(habits.projectedYear)} over a year at this pace. Each one is small; the pace is what adds up.`,
      href: "/orders",
      cta: "See orders",
    });
  }

  if (habits.weeklyStreak >= STREAK_WEEKS) {
    advice.push({
      id: "order-streak",
      tone: "warning",
      title: `A new order every week for ${habits.weeklyStreak} weeks straight`,
      body: `Not one week without something going on a plan. One deliberate week off is the cheapest experiment you can run: it shows whether the plans are a tool or a habit.`,
      href: "/orders",
      cta: "See orders",
    });
  }

  if (habits.priorYear.total > 0) {
    const change = (habits.lastYear.total - habits.priorYear.total) / habits.priorYear.total;
    if (change >= TREND_THRESHOLD) {
      advice.push({
        id: "year-up",
        tone: "warning",
        title: `${percent(change)} more on instalments than the year before`,
        body: `${money(habits.lastYear.total)} across ${plural(habits.lastYear.count, "order")} in the last twelve months, against ${money(habits.priorYear.total)} across ${plural(habits.priorYear.count, "order")} the year before.`,
      });
    } else if (change <= -TREND_THRESHOLD) {
      advice.push({
        id: "year-down",
        tone: "success",
        title: `${percent(-change)} less on instalments than the year before`,
        body: `${money(habits.lastYear.total)} in the last twelve months against ${money(habits.priorYear.total)} the year before. That's the direction that keeps fees at zero and the clear-by date close.`,
      });
    }
  }

  const nearlyDone = active.filter(
    (o) =>
      o.ledger.instalments.length > 1 &&
      o.ledger.remainingCount === 1 &&
      o.ledger.owedWithoutPending > 0,
  );
  if (nearlyDone.length > 0) {
    const total = sum(nearlyDone.map((o) => o.ledger.owedWithoutPending));
    advice.push({
      id: "close-out",
      tone: "info",
      title: `${plural(nearlyDone.length, "order")} ${nearlyDone.length === 1 ? "is" : "are"} one payment from done`,
      body: `Together they need ${money(total)}. Paying early costs nothing extra on an instalment plan and leaves fewer due dates to keep track of.`,
      href: "/orders?status=active",
      cta: "See active orders",
    });
  }

  const activeProviders = providers.filter((p) => p.activeOrders > 0).length;
  if (activeProviders >= MANY_PROVIDERS) {
    advice.push({
      id: "many-providers",
      tone: "info",
      title: `You're juggling ${activeProviders} providers at once`,
      body: `Each one has its own collection day and its own late fee. Finish what's open with the smaller ones before starting a new plan, and it gets easier to keep straight.`,
      href: "/providers",
      cta: "See providers",
    });
  }

  if (trend.prior.total > 0) {
    const change = (trend.recent.total - trend.prior.total) / trend.prior.total;
    if (change >= TREND_THRESHOLD) {
      advice.push({
        id: "spending-up",
        tone: "warning",
        title: `New instalment spending is up ${percent(change)}`,
        body: `You took on ${money(trend.recent.total)} across ${plural(trend.recent.count, "order")} in the last 90 days, against ${money(trend.prior.total)} in the 90 before. Each plan is a fortnightly commitment; check the next-three-months figure before adding another.`,
        href: "/upcoming",
        cta: "See upcoming",
      });
    } else if (change <= -TREND_THRESHOLD) {
      advice.push({
        id: "spending-down",
        tone: "success",
        title: `New instalment spending is down ${percent(-change)}`,
        body: `${money(trend.recent.total)} in the last 90 days against ${money(trend.prior.total)} in the 90 before. Fewer plans running at once is the surest way to keep fees at zero.`,
      });
    }
  }

  if (active.length >= 2) {
    const largest = [...active].sort((a, b) => b.ledger.owedAmount - a.ledger.owedAmount)[0]!;
    const share = largest.ledger.owedAmount / owed;
    if (share > BIG_ORDER_SHARE) {
      advice.push({
        id: "big-order-share",
        tone: "info",
        title: `One order is ${percent(share)} of what you owe`,
        body: `${largest.merchant} still has ${money(largest.ledger.owedAmount)} to go across ${plural(largest.ledger.remainingCount, "payment")}. Everything else is small by comparison, so this is the plan to watch.`,
        href: `/orders/${largest.id}`,
        cta: "See the order",
      });
    }
  }

  const yearByMerchant = new Map<string, InsightOrder[]>();
  for (const o of lastYear) yearByMerchant.set(o.merchant, [...(yearByMerchant.get(o.merchant) ?? []), o]);
  const repeat = [...yearByMerchant.entries()]
    .filter(([, mine]) => mine.length >= REPEAT_MERCHANT_ORDERS)
    .sort(([, a], [, b]) => b.length - a.length)[0];
  if (repeat) {
    const [name, mine] = repeat;
    const total = sum(mine.map((o) => o.totalAmountCents));
    const share = habits.lastYear.total > 0 ? total / habits.lastYear.total : 0;
    advice.push({
      id: "repeat-merchant",
      tone: "info",
      title: `${plural(mine.length, "order")} with ${name} in the last year`,
      body: `That's ${money(total)}, ${percent(share)} of everything you put on instalments this year. Halving it would free up about ${money(Math.round(total / 24))} a month. A small pause before the next one is worth more than any fee waiver.`,
      href: `/orders?merchant=${encodeURIComponent(name)}`,
      cta: `See ${name} orders`,
    });
  }

  const smallOrders = lastYear.filter((o) => o.totalAmountCents < SMALL_ORDER_CENTS);
  if (smallOrders.length >= SMALL_ORDER_COUNT) {
    const total = sum(smallOrders.map((o) => o.totalAmountCents));
    advice.push({
      id: "small-orders",
      tone: "info",
      title: `${plural(smallOrders.length, "purchase")} under ${money(SMALL_ORDER_CENTS)} went on instalments`,
      body: `Together they come to ${money(total)}, about ${money(Math.round(total / 12))} a month. Each small plan still brings its own due dates and late-fee risk; paying amounts this size outright keeps the list short.`,
      href: "/orders",
      cta: "See orders",
    });
  }

  if (habits.multiOrderDays >= MULTI_ORDER_DAYS && habits.busiestDay) {
    const busiest = habits.busiestDay;
    advice.push({
      id: "multi-order-days",
      tone: "info",
      title: `${plural(habits.multiOrderDays, "day")} with more than one order`,
      body: `Your busiest was ${date(busiest.date)}: ${plural(busiest.count, "order")} for ${money(busiest.total)}. The second order of the day is the one to pause on; it's rarely the one you planned.`,
      href: "/orders",
      cta: "See orders",
    });
  }

  if (habits.lastYear.count >= WEEKEND_MIN_ORDERS && habits.weekendShare >= WEEKEND_SHARE) {
    advice.push({
      id: "weekend-orders",
      tone: "info",
      title: `${percent(habits.weekendShare)} of your orders are placed Friday to Sunday`,
      body: `Weekend spending is the easiest kind to plan for. Decide a weekend amount on Friday and pay it outright, and instalment plans stop being the default.`,
      href: "/orders",
      cta: "See orders",
    });
  }

  if (providers.length >= 2 && owed > 0) {
    const top = providers[0]!;
    const share = top.owed / owed;
    if (share >= PROVIDER_SHARE) {
      advice.push({
        id: "provider-share",
        tone: "info",
        title: `${percent(share)} of what you owe is with ${top.name}`,
        body: `One provider's collection days decide most of your cash flow. Keep their dates front of mind, and check whether they let you move the payment day to just after you're paid.`,
        href: "/providers",
        cta: "See providers",
      });
    }
  }

  if (refunded > 0) {
    advice.push({
      id: "refunds",
      tone: "info",
      title: `${money(refunded)} refunded across ${plural(refundedOrdersList.length, "order")}`,
      body: `Refunds on instalment plans should shrink the remaining payments, not just land in your account. Check each plan reflects the credit before the next collection.`,
      href: "/orders",
      cta: "See orders",
    });
  }

  if (pending > 0) {
    advice.push({
      id: "pending",
      tone: "info",
      title: `${money(pending)} is pending`,
      body: `It has been taken but hasn't cleared, so it still counts as owed here. Don't treat it as spare balance until it settles.`,
    });
  }

  if (habits.daysSinceLastOrder !== null && habits.daysSinceLastOrder >= QUIET_SPELL_DAYS) {
    advice.push({
      id: "quiet-spell",
      tone: "success",
      title: `${plural(habits.daysSinceLastOrder, "day")} since your last order`,
      body: `Nothing new has gone on a plan in that time. Every week without a new one brings the clear-by date closer and keeps the payment list short.`,
    });
  }

  if (live.length > 0 && active.length === 0) {
    advice.push({
      id: "all-clear",
      tone: "success",
      title: "Nothing owing",
      body: `Every plan is paid off. If you take on another, its due dates will show up here.`,
    });
  }

  if (live.length > 0 && fees.late === 0) {
    advice.push({
      id: "no-late-fees",
      tone: "success",
      title: "No late fees, ever",
      body: `Across ${plural(live.length, "order")} you've paid exactly what you bought cost and nothing more. Keep paying on the due date and instalment plans stay free.`,
    });
  }

  advice.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);

  return {
    owed,
    owedWithoutPending,
    pending,
    overdue,
    overdueCount: overdueInstalments.length,
    activeOrders: active.length,
    settledOrders: settled.length,
    totalOrders: orders.length,
    purchased,
    paid,
    fees,
    feeRate,
    clearBy,
    months,
    providers,
    trend,
    biggestOrders,
    merchants,
    history,
    averageOrder,
    refunded,
    refundedOrders: refundedOrdersList.length,
    channels,
    habits,
    advice,
  };
}
