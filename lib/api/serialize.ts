import type { OrderDetail, OrderWithLedger, Summary } from "@/lib/db/queries";
import type { Fee, Payment, Refund } from "@/lib/db/schema";
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
