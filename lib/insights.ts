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

export interface InsightOrder {
  id: string;
  merchant: string;
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
  advice: Advice[];
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

function feesOf(order: InsightOrder, kind?: FeeKind): number {
  return sum(
    order.ledger.instalments.flatMap((i) =>
      i.fees.filter((f) => kind === undefined || f.kind === kind).map((f) => f.amountCents),
    ),
  );
}

function findCrunch(
  unpaid: readonly { dueOn: string; amountOwed: number }[],
  today: string,
): { from: string; to: string; count: number; total: number } | null {
  const horizon = addDays(today, CRUNCH_HORIZON_DAYS);
  const ahead = unpaid
    .filter((i) => i.dueOn >= today && i.dueOn <= horizon)
    .sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0));

  let best: { from: string; to: string; count: number; total: number } | null = null;
  for (let start = 0; start < ahead.length; start += 1) {
    const from = ahead[start]!.dueOn;
    const to = addDays(from, CRUNCH_WINDOW_DAYS - 1);
    const inWindow = ahead.slice(start).filter((i) => i.dueOn <= to);
    if (inWindow.length < CRUNCH_MIN_PAYMENTS) continue;
    const total = sum(inWindow.map((i) => i.amountOwed));
    if (best === null || total > best.total) {
      best = { from, to: inWindow[inWindow.length - 1]!.dueOn, count: inWindow.length, total };
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

  const window = (from: number, to: number): SpendWindow => {
    const mine = live.filter((o) => {
      const age = daysBetween(o.purchasedAt.toISOString().slice(0, 10), today);
      return age >= from && age < to;
    });
    return { count: mine.length, total: sum(mine.map((o) => o.totalAmountCents)) };
  };
  const trend = {
    recent: window(0, TREND_WINDOW_DAYS),
    prior: window(TREND_WINDOW_DAYS, TREND_WINDOW_DAYS * 2),
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

  const crunch = findCrunch(unpaid, today);
  if (crunch) {
    advice.push({
      id: "crunch",
      tone: "warning",
      title: `${plural(crunch.count, "payment")} land between ${date(crunch.from)} and ${date(crunch.to)}`,
      body: `That's ${money(crunch.total)} inside one week. Make sure the money is sitting in the account beforehand; a failed collection is how most late fees start.`,
      href: "/upcoming",
      cta: "See upcoming",
    });
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

  if (pending > 0) {
    advice.push({
      id: "pending",
      tone: "info",
      title: `${money(pending)} is pending`,
      body: `It has been taken but hasn't cleared, so it still counts as owed here. Don't treat it as spare balance until it settles.`,
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
    advice,
  };
}
