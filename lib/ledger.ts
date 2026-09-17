import { addDays, assertIsoDate } from "@/lib/dates";

export type InstalmentState = "paid" | "pending" | "overdue" | "upcoming";
export type OrderStatus = "active" | "settled" | "cancelled";

export interface FeeInput {
  amountCents: number;
}

export interface RefundInput {
  amountCents: number;
}

export interface InstalmentInput {
  sequence: number;
  dueOn: string;
  principalCents: number;
  paidCents: number;
  pendingCents: number;
  waivedCents: number;
  fees: readonly FeeInput[];
}

export interface OrderInput<I extends InstalmentInput = InstalmentInput> {
  totalAmountCents: number;
  instalments: readonly I[];
  refunds: readonly RefundInput[];
  cancelled?: boolean;
}

export interface InstalmentLedger {
  feesTotal: number;
  amountWithFees: number;
  amountOwed: number;
  amountPayable: number;
  state: InstalmentState;
}

export type LedgerInstalment<I extends InstalmentInput = InstalmentInput> =
  I & InstalmentLedger;

export interface OrderLedger<I extends InstalmentInput = InstalmentInput> {
  totalPaid: number;
  totalFees: number;
  amountRefunded: number;
  owedAmount: number;
  pendingAmount: number;
  owedWithoutPending: number;
  totalAfterRefunds: number;
  trueCost: number;
  status: OrderStatus;
  paidCount: number;
  remainingCount: number;
  nextDue: LedgerInstalment<I> | null;
  instalments: LedgerInstalment<I>[];
}

export interface ScheduledInstalment {
  sequence: number;
  dueOn: string;
  principalCents: number;
}

export interface ScheduleOptions {
  totalAmountCents: number;
  instalmentCount: number;
  firstDueOn: string;
  intervalDays?: number;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function computeInstalment(
  instalment: InstalmentInput,
  today: string,
): InstalmentLedger {
  const feesTotal = sum(instalment.fees.map((fee) => fee.amountCents));
  const amountWithFees = instalment.principalCents + feesTotal;
  const amountOwed = Math.max(
    0,
    amountWithFees - instalment.paidCents - instalment.waivedCents,
  );
  const amountPayable = Math.max(0, amountOwed - instalment.pendingCents);

  let state: InstalmentState;
  if (amountOwed === 0) state = "paid";
  else if (instalment.pendingCents > 0 && amountPayable === 0) state = "pending";
  else if (instalment.dueOn < today) state = "overdue";
  else state = "upcoming";

  return { feesTotal, amountWithFees, amountOwed, amountPayable, state };
}

export function deriveOrderStatus(owedAmount: number): OrderStatus {
  return owedAmount > 0 ? "active" : "settled";
}

export function computeOrder<I extends InstalmentInput>(
  order: OrderInput<I>,
  today: string,
): OrderLedger<I> {
  const instalments = [...order.instalments]
    .sort((a, b) => a.sequence - b.sequence)
    .map((instalment) => ({
      ...instalment,
      ...computeInstalment(instalment, today),
    }));

  const totalPaid = sum(instalments.map((i) => i.paidCents));
  const totalFees = sum(instalments.map((i) => i.feesTotal));
  const amountRefunded = sum(order.refunds.map((r) => r.amountCents));
  const owedAmount = sum(instalments.map((i) => i.amountOwed));
  const pendingAmount = sum(instalments.map((i) => i.pendingCents));
  const owedWithoutPending = sum(instalments.map((i) => i.amountPayable));
  const paidCount = instalments.filter((i) => i.state === "paid").length;
  const unpaid = instalments.filter((i) => i.state !== "paid");
  const nextDue =
    unpaid.reduce<LedgerInstalment<I> | null>(
      (best, i) => (best === null || i.dueOn < best.dueOn ? i : best),
      null,
    ) ?? null;

  return {
    totalPaid,
    totalFees,
    amountRefunded,
    owedAmount,
    pendingAmount,
    owedWithoutPending,
    totalAfterRefunds: order.totalAmountCents - amountRefunded,
    trueCost: totalPaid + owedAmount - amountRefunded,
    status: order.cancelled ? "cancelled" : deriveOrderStatus(owedAmount),
    paidCount,
    remainingCount: instalments.length - paidCount,
    nextDue,
    instalments,
  };
}

// Matches how pay-in-N providers split: round each instalment to the nearest
// cent and let the last one absorb the difference.
export function generateSchedule({
  totalAmountCents,
  instalmentCount,
  firstDueOn,
  intervalDays = 14,
}: ScheduleOptions): ScheduledInstalment[] {
  if (!Number.isInteger(totalAmountCents) || totalAmountCents < 0) {
    throw new Error(`Total must be a non-negative integer, got ${totalAmountCents}`);
  }
  if (!Number.isInteger(instalmentCount) || instalmentCount < 1) {
    throw new Error(`Instalment count must be at least 1, got ${instalmentCount}`);
  }
  assertIsoDate(firstDueOn);

  let each = Math.round(totalAmountCents / instalmentCount);
  let last = totalAmountCents - each * (instalmentCount - 1);
  if (last < 0) {
    each = Math.floor(totalAmountCents / instalmentCount);
    last = totalAmountCents - each * (instalmentCount - 1);
  }

  return Array.from({ length: instalmentCount }, (_, index) => ({
    sequence: index + 1,
    dueOn: addDays(firstDueOn, index * intervalDays),
    principalCents: index === instalmentCount - 1 ? last : each,
  }));
}

// Spreads a known total paid across instalments in order; any excess lands
// on the last instalment as an over-payment.
export function allocatePaid(
  principals: readonly number[],
  paidCents: number,
): number[] {
  if (!Number.isInteger(paidCents) || paidCents < 0) {
    throw new Error(`Paid amount must be a non-negative integer, got ${paidCents}`);
  }
  const allocated: number[] = [];
  let remaining = paidCents;
  for (const principal of principals) {
    const take = Math.min(principal, remaining);
    allocated.push(take);
    remaining -= take;
  }
  const last = allocated.pop();
  if (last !== undefined) allocated.push(last + remaining);
  return allocated;
}

export function dueWithin(
  instalments: readonly LedgerInstalment[],
  today: string,
  periodDays: number,
): number {
  const horizon = addDays(today, periodDays);
  return sum(
    instalments
      .filter((i) => i.state !== "paid" && i.dueOn <= horizon)
      .map((i) => i.amountOwed),
  );
}

export function overdueTotal(instalments: readonly LedgerInstalment[]): number {
  return sum(
    instalments.filter((i) => i.state === "overdue").map((i) => i.amountOwed),
  );
}
