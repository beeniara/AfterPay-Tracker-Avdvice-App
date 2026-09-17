import type { OrderDetail, OrderWithLedger, Summary } from "@/lib/db/queries";
import type { Fee, Payment, Refund } from "@/lib/db/schema";
import type { Insights } from "@/lib/insights";
import type { LedgerInstalment } from "@/lib/ledger";
import { toMoney, type Money } from "@/lib/money";

type AnyInstalment = LedgerInstalment<{
  id: string;
  sequence: number;
  dueOn: string;
  principalCents: number;
  paidCents: number;
  pendingCents: number;
  waivedCents: number;
  fees: Fee[];
  payments?: Payment[];
}>;

export function serializeInstalment(i: AnyInstalment, currency: string) {
  const m = (cents: number): Money => toMoney(cents, currency);
  return {
    id: i.id,
    sequence: i.sequence,
    dueOn: i.dueOn,
    state: i.state,
    amount: m(i.principalCents),
    amountWithFees: m(i.amountWithFees),
    amountPaid: m(i.paidCents),
    amountPending: m(i.pendingCents),
    amountWaived: m(i.waivedCents),
    amountOwed: m(i.amountOwed),
    amountPayable: m(i.amountPayable),
    fees: i.fees.map((f) => ({
      id: f.id,
      kind: f.kind,
      amount: m(f.amountCents),
      incurredOn: f.incurredOn,
      note: f.note,
    })),
    payments: (i.payments ?? []).map((p) => ({
      id: p.id,
      amount: m(p.amountCents),
      paidOn: p.paidOn,
      method: p.method,
      reference: p.reference,
    })),
  };
}

function serializeRefund(r: Refund, currency: string) {
  return { id: r.id, amount: toMoney(r.amountCents, currency), refundedOn: r.refundedOn, note: r.note };
}

export function serializeOrder(order: OrderWithLedger | OrderDetail) {
  const { currency, ledger } = order;
  const m = (cents: number): Money => toMoney(cents, currency);
  return {
    id: order.id,
    merchant: order.merchant,
    reference: order.reference,
    channel: order.channel,
    purchasedAt: order.purchasedAt.toISOString(),
    currency,
    instalmentCount: order.instalmentCount,
    status: ledger.status,
    notes: order.notes,
    provider: { id: order.provider.id, name: order.provider.name, kind: order.provider.kind },
    totalAmount: m(order.totalAmountCents),
    totalPaid: m(ledger.totalPaid),
    totalFees: m(ledger.totalFees),
    amountRefunded: m(ledger.amountRefunded),
    owedAmount: m(ledger.owedAmount),
    pendingAmount: m(ledger.pendingAmount),
    owedWithoutPending: m(ledger.owedWithoutPending),
    totalAfterRefunds: m(ledger.totalAfterRefunds),
    trueCost: m(ledger.trueCost),
    paidCount: ledger.paidCount,
    remainingCount: ledger.remainingCount,
    instalments: ledger.instalments.map((i) => serializeInstalment(i, currency)),
    refunds: order.refunds.map((r) => serializeRefund(r, currency)),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

export function serializeSummary(summary: Summary) {
  const m = (cents: number): Money => toMoney(cents, summary.currency);
  return {
    total: m(summary.total),
    owedWithoutPending: m(summary.owedWithoutPending),
    pending: m(summary.pending),
    duePeriods: summary.duePeriods.map((p) => ({ ...p, total: m(p.total) })),
    overdue: summary.overdue,
    overdueTotal: m(summary.overdueTotal),
    activeOrders: summary.activeOrders,
    totalOrders: summary.totalOrders,
    byProviderKind: summary.byProviderKind.map((k) => ({ ...k, total: m(k.total) })),
  };
}

export function serializeInsights(insights: Insights, currency: string) {
  const m = (cents: number): Money => toMoney(cents, currency);
  const window = (w: { count: number; total: number }) => ({ count: w.count, total: m(w.total) });
  return {
    owed: m(insights.owed),
    owedWithoutPending: m(insights.owedWithoutPending),
    pending: m(insights.pending),
    overdue: m(insights.overdue),
    overdueCount: insights.overdueCount,
    activeOrders: insights.activeOrders,
    settledOrders: insights.settledOrders,
    totalOrders: insights.totalOrders,
    purchased: m(insights.purchased),
    paid: m(insights.paid),
    fees: {
      total: m(insights.fees.total),
      late: m(insights.fees.late),
      establishment: m(insights.fees.establishment),
      other: m(insights.fees.other),
      waived: m(insights.fees.waived),
      onActive: m(insights.fees.onActive),
    },
    feeRate: insights.feeRate,
    clearBy: insights.clearBy,
    months: insights.months.map((x) => ({ ...x, total: m(x.total) })),
    providers: insights.providers.map((p) => ({
      ...p,
      owed: m(p.owed),
      fees: m(p.fees),
      lateFees: m(p.lateFees),
    })),
    trend: { recent: window(insights.trend.recent), prior: window(insights.trend.prior) },
    biggestOrders: insights.biggestOrders.map((o) => ({
      ...o,
      total: m(o.total),
      trueCost: m(o.trueCost),
      owed: m(o.owed),
    })),
    merchants: insights.merchants.map((x) => ({
      ...x,
      spent: m(x.spent),
      fees: m(x.fees),
      lateFees: m(x.lateFees),
    })),
    history: insights.history.map((x) => ({ ...x, total: m(x.total) })),
    averageOrder: m(insights.averageOrder),
    refunded: m(insights.refunded),
    refundedOrders: insights.refundedOrders,
    channels: { online: window(insights.channels.online), inStore: window(insights.channels.inStore) },
    habits: {
      ...insights.habits,
      spendPerWeek: m(insights.habits.spendPerWeek),
      projectedYear: m(insights.habits.projectedYear),
      busiestDay: insights.habits.busiestDay
        ? { ...insights.habits.busiestDay, total: m(insights.habits.busiestDay.total) }
        : null,
      lastYear: window(insights.habits.lastYear),
      priorYear: window(insights.habits.priorYear),
    },
    advice: insights.advice,
  };
}
