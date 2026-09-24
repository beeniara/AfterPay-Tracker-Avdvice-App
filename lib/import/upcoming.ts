import { and, eq, ne } from "drizzle-orm";
import { colorSeedFor } from "@/lib/color-seed";
import { addDays, daysBetween, toIsoDate } from "@/lib/dates";
import type { Db, DbClient } from "@/lib/db";
import { refreshOrderStatus } from "@/lib/db/orders";
import { instalments, orders, payments, providers } from "@/lib/db/schema";
import { computeInstalment } from "@/lib/ledger";
import { parseAmount } from "@/lib/money";
import { normaliseDate } from "./orders";

// Reconciles a provider's "upcoming payments" export (one row per instalment
// still to be collected, no order numbers) against what the app already holds.
// Nothing is ever deleted: matched orders get their schedule corrected, orders
// the export no longer lists are settled, and orders it lists that the app has
// never seen are created.

export interface UpcomingRowInput {
  merchant: string;
  paymentNo: string;
  dueDate: string;
  amount: string;
}

export interface UpcomingOptions {
  providerName: string;
  currency: string;
  intervalDays: number;
  // Match against settled orders too and re-open them when the export still lists a payment.
  reopenSettled: boolean;
  // Mark active orders the export doesn't mention as paid off.
  settleMissing: boolean;
  // Create orders for instalments that match nothing.
  createUnmatched: boolean;
}

export interface UpcomingRow {
  line: number;
  merchant: string;
  merchantKey: string;
  sequence: number;
  count: number;
  dueOn: string;
  amountCents: number;
}

// Rows that belong to one order: same merchant and plan, consecutive-or-gapped
// sequences spaced by the interval, and equal amounts (the last may differ by
// the rounding it absorbs).
export interface Chain {
  merchant: string;
  merchantKey: string;
  count: number;
  rows: UpcomingRow[];
  eachCents: number;
  // Where instalment 1 falls, implied by the earliest row.
  firstDueOn: string;
}

export interface ExistingInstalment {
  id: string;
  sequence: number;
  dueOn: string;
  principalCents: number;
  paidCents: number;
  pendingCents: number;
  waivedCents: number;
  feesCents: number;
}

export interface ExistingOrder {
  id: string;
  merchant: string;
  reference: string | null;
  status: "active" | "settled" | "cancelled";
  purchasedOn: string;
  instalmentCount: number;
  totalAmountCents: number;
  instalments: ExistingInstalment[];
}

export interface OrderUpdate {
  orderId: string;
  merchant: string;
  reference: string | null;
  purchasedOn: string;
  wasSettled: boolean;
  redate: { instalmentId: string; sequence: number; from: string; to: string }[];
  markPaid: { instalmentId: string; sequence: number; amountCents: number; paidOn: string }[];
  // amountCents is how much recorded payment is undone; paidTo what remains.
  reopen: { instalmentId: string; sequence: number; amountCents: number; paidTo: number }[];
  owingBefore: number;
  owingAfter: number;
}

export interface OrderCreate {
  merchant: string;
  channel: "online" | "in_store";
  purchasedOn: string;
  totalAmountCents: number;
  instalmentCount: number;
  schedule: { sequence: number; dueOn: string; principalCents: number; paidCents: number }[];
  owing: number;
  lines: number[];
}

export interface UpcomingPlan {
  rows: UpcomingRow[];
  errors: { line: number; message: string }[];
  chains: Chain[];
  updates: OrderUpdate[];
  creates: OrderCreate[];
  settles: OrderUpdate[];
  owingBefore: number;
  owingAfter: number;
  upcomingCents: number;
}

export const PAYMENT_NO = /(\d+)\s*(?:of|\/)\s*(\d+)/i;
// Provider and app splits agree to the cent in practice; allow a little slack.
const AMOUNT_TOLERANCE_CENTS = 2;

export function merchantKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseUpcomingRows(
  rows: readonly UpcomingRowInput[],
  currency: string,
): { rows: UpcomingRow[]; errors: UpcomingPlan["errors"] } {
  const parsed: UpcomingRow[] = [];
  const errors: UpcomingPlan["errors"] = [];
  rows.forEach((row, index) => {
    const line = index + 2;
    try {
      const merchant = row.merchant.trim();
      if (!merchant) throw new Error("Merchant is empty");
      const no = PAYMENT_NO.exec(row.paymentNo);
      if (!no) throw new Error(`Unrecognised payment number "${row.paymentNo}" (expected e.g. "2 of 4")`);
      const sequence = Number(no[1]);
      const count = Number(no[2]);
      if (sequence < 1 || sequence > count) throw new Error(`Payment number ${sequence} of ${count} is out of range`);
      const dueOn = normaliseDate(row.dueDate);
      if (!dueOn) throw new Error(`Unrecognised due date "${row.dueDate}"`);
      const amountCents = parseAmount(row.amount, currency).cents;
      if (amountCents <= 0) throw new Error("Amount due must be positive");
      parsed.push({ line, merchant, merchantKey: merchantKey(merchant), sequence, count, dueOn, amountCents });
    } catch (error) {
      errors.push({ line, message: error instanceof Error ? error.message : String(error) });
    }
  });
  return { rows: parsed, errors };
}

function amountFits(chain: Chain, row: UpcomingRow): boolean {
  const diff = Math.abs(row.amountCents - chain.eachCents);
  return row.sequence === chain.count ? diff <= chain.count : diff === 0;
}

// Greedy: rows are walked in due-date order and attached to the first open
// chain they continue. Orders with identical merchant, amounts and dates are
// interchangeable, so a wrong pick between them changes nothing.
export function chainRows(rows: readonly UpcomingRow[], intervalDays: number): Chain[] {
  const sorted = [...rows].sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.sequence - b.sequence);
  const chains: Chain[] = [];
  for (const row of sorted) {
    const home = chains.find((chain) => {
      const last = chain.rows[chain.rows.length - 1]!;
      return (
        chain.merchantKey === row.merchantKey &&
        chain.count === row.count &&
        last.sequence < row.sequence &&
        daysBetween(last.dueOn, row.dueOn) === intervalDays * (row.sequence - last.sequence) &&
        amountFits(chain, row)
      );
    });
    if (home) {
      home.rows.push(row);
    } else {
      chains.push({
        merchant: row.merchant,
        merchantKey: row.merchantKey,
        count: row.count,
        rows: [row],
        eachCents: row.amountCents,
        firstDueOn: addDays(row.dueOn, -intervalDays * (row.sequence - 1)),
      });
    }
  }
  return chains;
}

function owedNow(inst: ExistingInstalment, today: string): number {
  return computeInstalment({ ...inst, fees: [{ amountCents: inst.feesCents }] }, today).amountOwed;
}

function owingOf(order: ExistingOrder, today: string): number {
  return order.instalments.reduce((sum, i) => sum + owedNow(i, today), 0);
}

function settleAll(order: ExistingOrder, today: string): OrderUpdate {
  const markPaid = order.instalments
    .filter((i) => owedNow(i, today) > 0)
    .map((i) => ({
      instalmentId: i.id,
      sequence: i.sequence,
      amountCents: owedNow(i, today),
      paidOn: i.dueOn < today ? i.dueOn : today,
    }));
  return {
    orderId: order.id,
    merchant: order.merchant,
    reference: order.reference,
    purchasedOn: order.purchasedOn,
    wasSettled: false,
    redate: [],
    markPaid,
    reopen: [],
    owingBefore: owingOf(order, today),
    owingAfter: 0,
  };
}

// An order can only be the one a chain describes if it was bought shortly
// before the chain's first instalment: providers collect the first payment
// within one interval of purchase.
function purchaseWindowFits(order: ExistingOrder, chain: Chain, intervalDays: number): boolean {
  const gap = daysBetween(order.purchasedOn, chain.firstDueOn);
  return gap >= -3 && gap <= 2 * intervalDays;
}

// After a partial refund the provider shrinks the remaining instalments, so
// their amounts no longer match the app's split. What still holds is that the
// instalments the app shows as owed are exactly the ones the export lists,
// for the same total.
function owedSetMatches(order: ExistingOrder, chain: Chain, today: string): boolean {
  const owed = order.instalments.filter((i) => owedNow(i, today) > 0);
  if (owed.length !== chain.rows.length) return false;
  const listed = new Set(chain.rows.map((r) => r.sequence));
  if (!owed.every((i) => listed.has(i.sequence))) return false;
  const owedTotal = owed.reduce((sum, i) => sum + owedNow(i, today), 0);
  const listedTotal = chain.rows.reduce((sum, r) => sum + r.amountCents, 0);
  return Math.abs(owedTotal - listedTotal) <= AMOUNT_TOLERANCE_CENTS;
}

function candidateScore(order: ExistingOrder, chain: Chain, intervalDays: number, today: string): number | null {
  if (order.status === "cancelled") return null;
  if (merchantKey(order.merchant) !== chain.merchantKey) return null;
  if (order.instalmentCount !== chain.count) return null;
  if (!purchaseWindowFits(order, chain, intervalDays)) return null;
  let score = order.status === "settled" ? 1000 : 0;
  let amountsAgree = true;
  for (const row of chain.rows) {
    const inst = order.instalments.find((i) => i.sequence === row.sequence);
    if (!inst) return null;
    if (Math.abs(inst.principalCents - row.amountCents) > AMOUNT_TOLERANCE_CENTS) amountsAgree = false;
    score += Math.abs(daysBetween(inst.dueOn, row.dueOn));
  }
  if (!amountsAgree) {
    if (!owedSetMatches(order, chain, today)) return null;
    score += 100;
  }
  // Between look-alike orders (same merchant and amounts, bought days apart),
  // the one whose owed instalments are exactly the listed ones is the match;
  // every instalment that would have to flip paid/unpaid counts against it.
  const listed = new Set(chain.rows.map((r) => r.sequence));
  for (const inst of order.instalments) {
    if ((owedNow(inst, today) > 0) !== listed.has(inst.sequence)) score += 50;
  }
  score += Math.abs(daysBetween(order.purchasedOn, addDays(chain.firstDueOn, -intervalDays)));
  return score;
}

function updateFor(order: ExistingOrder, chain: Chain, today: string): OrderUpdate {
  const listed = new Map(chain.rows.map((r) => [r.sequence, r]));
  const update: OrderUpdate = {
    orderId: order.id,
    merchant: order.merchant,
    reference: order.reference,
    purchasedOn: order.purchasedOn,
    wasSettled: order.status === "settled",
    redate: [],
    markPaid: [],
    reopen: [],
    owingBefore: owingOf(order, today),
    owingAfter: 0,
  };
  for (const inst of order.instalments) {
    const row = listed.get(inst.sequence);
    if (row) {
      if (inst.dueOn !== row.dueOn) {
        update.redate.push({ instalmentId: inst.id, sequence: inst.sequence, from: inst.dueOn, to: row.dueOn });
      }
      // The export says exactly this much is still due. If the app has more
      // of it marked paid, undo just enough recorded payment to agree; if the
      // app shows more owed (a refund it doesn't know of) leave it be rather
      // than invent a payment.
      const gross = Math.max(0, inst.principalCents + inst.feesCents - inst.waivedCents);
      const owed = owedNow(inst, today);
      if (owed + AMOUNT_TOLERANCE_CENTS < row.amountCents && inst.paidCents > 0) {
        const paidTo = Math.max(0, gross - row.amountCents);
        update.reopen.push({ instalmentId: inst.id, sequence: inst.sequence, amountCents: inst.paidCents - paidTo, paidTo });
        update.owingAfter += gross - paidTo;
      } else {
        update.owingAfter += owed;
      }
    } else {
      const owed = owedNow(inst, today);
      if (owed > 0) {
        update.markPaid.push({
          instalmentId: inst.id,
          sequence: inst.sequence,
          amountCents: owed,
          paidOn: inst.dueOn < today ? inst.dueOn : today,
        });
      }
    }
  }
  return update;
}

function createFor(chain: Chain, intervalDays: number): OrderCreate {
  const listed = new Map(chain.rows.map((r) => [r.sequence, r]));
  const schedule = Array.from({ length: chain.count }, (_, index) => {
    const sequence = index + 1;
    const row = listed.get(sequence);
    const principalCents = row?.amountCents ?? chain.eachCents;
    return {
      sequence,
      dueOn: row?.dueOn ?? addDays(chain.firstDueOn, intervalDays * index),
      principalCents,
      paidCents: row ? 0 : principalCents,
    };
  });
  return {
    merchant: chain.merchant,
    channel: /in.?store/i.test(chain.merchant) ? "in_store" : "online",
    // The export doesn't carry the purchase date; the first instalment falls
    // within one interval of it.
    purchasedOn: addDays(chain.firstDueOn, -intervalDays),
    totalAmountCents: schedule.reduce((sum, s) => sum + s.principalCents, 0),
    instalmentCount: chain.count,
    schedule,
    owing: chain.rows.reduce((sum, r) => sum + r.amountCents, 0),
    lines: chain.rows.map((r) => r.line),
  };
}

// Pure: decides what would change without touching the database.
export function planUpcoming(
  rowsIn: readonly UpcomingRowInput[],
  existing: readonly ExistingOrder[],
  options: UpcomingOptions,
  today: string,
): UpcomingPlan {
  const { rows, errors } = parseUpcomingRows(rowsIn, options.currency);
  const chains = chainRows(rows, options.intervalDays);
  const claimed = new Set<string>();
  const updates: OrderUpdate[] = [];
  const creates: OrderCreate[] = [];

  // Longer chains carry more evidence, so they pick first.
  const ordered = [...chains].sort((a, b) => b.rows.length - a.rows.length || a.firstDueOn.localeCompare(b.firstDueOn));
  for (const chain of ordered) {
    let best: { order: ExistingOrder; score: number } | null = null;
    for (const order of existing) {
      if (claimed.has(order.id)) continue;
      if (order.status === "settled" && !options.reopenSettled) continue;
      const score = candidateScore(order, chain, options.intervalDays, today);
      if (score !== null && (best === null || score < best.score)) best = { order, score };
    }
    if (best) {
      claimed.add(best.order.id);
      updates.push(updateFor(best.order, chain, today));
    } else if (options.createUnmatched) {
      creates.push(createFor(chain, options.intervalDays));
    }
  }

  const settles = options.settleMissing
    ? existing
        .filter((o) => o.status === "active" && !claimed.has(o.id) && owingOf(o, today) > 0)
        .map((o) => settleAll(o, today))
    : [];

  const owingBefore = existing.filter((o) => o.status !== "cancelled").reduce((sum, o) => sum + owingOf(o, today), 0);
  const untouched = existing
    .filter((o) => o.status !== "cancelled" && !claimed.has(o.id) && !settles.some((s) => s.orderId === o.id))
    .reduce((sum, o) => sum + owingOf(o, today), 0);
  const owingAfter =
    untouched + updates.reduce((sum, u) => sum + u.owingAfter, 0) + creates.reduce((sum, c) => sum + c.owing, 0);

  return {
    rows,
    errors,
    chains,
    updates,
    creates,
    settles,
    owingBefore,
    owingAfter,
    upcomingCents: rows.reduce((sum, r) => sum + r.amountCents, 0),
  };
}

export async function loadExistingOrders(db: DbClient, userId: string, providerId: string): Promise<ExistingOrder[]> {
  const rows = await db.query.orders.findMany({
    where: and(eq(orders.userId, userId), eq(orders.providerId, providerId), ne(orders.status, "cancelled")),
    with: { instalments: { with: { fees: true }, orderBy: (i, { asc }) => [asc(i.sequence)] } },
  });
  return rows.map((o) => ({
    id: o.id,
    merchant: o.merchant,
    reference: o.reference,
    status: o.status,
    purchasedOn: toIsoDate(o.purchasedAt, "UTC"),
    instalmentCount: o.instalmentCount,
    totalAmountCents: o.totalAmountCents,
    instalments: o.instalments.map((i) => ({
      id: i.id,
      sequence: i.sequence,
      dueOn: i.dueOn,
      principalCents: i.principalCents,
      paidCents: i.paidCents,
      pendingCents: i.pendingCents,
      waivedCents: i.waivedCents,
      feesCents: i.fees.reduce((sum, f) => sum + f.amountCents, 0),
    })),
  }));
}

export async function prepareUpcoming(
  db: DbClient,
  userId: string,
  rows: readonly UpcomingRowInput[],
  options: UpcomingOptions,
  today: string,
): Promise<UpcomingPlan> {
  const provider = await db.query.providers.findFirst({
    where: and(eq(providers.userId, userId), eq(providers.name, options.providerName)),
    columns: { id: true },
  });
  const existing = provider ? await loadExistingOrders(db, userId, provider.id) : [];
  return planUpcoming(rows, existing, options, today);
}

export interface UpcomingResult {
  updated: number;
  reopened: number;
  created: number;
  settled: number;
  redated: number;
  markedPaid: number;
  reopenedInstalments: number;
}

async function applyUpdate(tx: DbClient, update: OrderUpdate, today: string): Promise<void> {
  const now = new Date();
  for (const r of update.redate) {
    await tx.update(instalments).set({ dueOn: r.to, updatedAt: now }).where(eq(instalments.id, r.instalmentId));
  }
  for (const r of update.reopen) {
    await tx.delete(payments).where(eq(payments.instalmentId, r.instalmentId));
    await tx.update(instalments).set({ paidCents: r.paidTo, updatedAt: now }).where(eq(instalments.id, r.instalmentId));
    if (r.paidTo > 0) {
      const inst = await tx.query.instalments.findFirst({ where: eq(instalments.id, r.instalmentId), columns: { dueOn: true } });
      await tx.insert(payments).values({
        instalmentId: r.instalmentId,
        amountCents: r.paidTo,
        paidOn: inst && inst.dueOn < today ? inst.dueOn : today,
        method: "card",
        reference: "upcoming-payments export",
      });
    }
  }
  for (const p of update.markPaid) {
    const inst = await tx.query.instalments.findFirst({
      where: eq(instalments.id, p.instalmentId),
      columns: { paidCents: true, pendingCents: true },
    });
    if (!inst) continue;
    await tx
      .update(instalments)
      .set({
        paidCents: inst.paidCents + p.amountCents,
        pendingCents: inst.pendingCents - Math.min(inst.pendingCents, p.amountCents),
        updatedAt: now,
      })
      .where(eq(instalments.id, p.instalmentId));
    await tx.insert(payments).values({
      instalmentId: p.instalmentId,
      amountCents: p.amountCents,
      paidOn: p.paidOn,
      method: "card",
      reference: "upcoming-payments export",
    });
  }
  await refreshOrderStatus(tx, update.orderId, today);
}

// Re-plans inside the transaction so a stale preview can't apply to rows that
// changed in the meantime.
export async function commitUpcoming(
  db: Db,
  userId: string,
  rows: readonly UpcomingRowInput[],
  options: UpcomingOptions,
  today: string,
): Promise<UpcomingResult & { plan: UpcomingPlan }> {
  return db.transaction(async (tx) => {
    const [provider] = await tx
      .insert(providers)
      .values({ userId, name: options.providerName, kind: "bnpl", colorSeed: colorSeedFor(options.providerName) })
      .onConflictDoUpdate({ target: [providers.userId, providers.name], set: { updatedAt: new Date() } })
      .returning({ id: providers.id });
    const providerId = provider!.id;

    const existing = await loadExistingOrders(tx, userId, providerId);
    const plan = planUpcoming(rows, existing, options, today);
    if (plan.errors.length) throw new RangeError("Fix the invalid rows before importing");

    for (const update of plan.updates) await applyUpdate(tx, update, today);
    for (const settle of plan.settles) await applyUpdate(tx, settle, today);

    for (const create of plan.creates) {
      const [order] = await tx
        .insert(orders)
        .values({
          userId,
          providerId,
          merchant: create.merchant,
          reference: null,
          channel: create.channel,
          purchasedAt: new Date(`${create.purchasedOn}T00:00:00Z`),
          totalAmountCents: create.totalAmountCents,
          currency: options.currency,
          instalmentCount: create.instalmentCount,
          notes: `Added from an upcoming-payments export on ${today}; purchase date and total are estimated.`,
        })
        .returning({ id: orders.id });
      const inserted = await tx
        .insert(instalments)
        .values(create.schedule.map((s) => ({ orderId: order!.id, ...s })))
        .returning({ id: instalments.id, paidCents: instalments.paidCents, dueOn: instalments.dueOn });
      const paid = inserted
        .filter((i) => i.paidCents > 0)
        .map((i) => ({
          instalmentId: i.id,
          amountCents: i.paidCents,
          paidOn: i.dueOn < today ? i.dueOn : today,
          method: "card" as const,
          reference: "upcoming-payments export",
        }));
      if (paid.length) await tx.insert(payments).values(paid);
      await refreshOrderStatus(tx, order!.id, today);
    }

    return {
      plan,
      updated: plan.updates.filter((u) => !u.wasSettled).length,
      reopened: plan.updates.filter((u) => u.wasSettled).length,
      created: plan.creates.length,
      settled: plan.settles.length,
      redated: plan.updates.reduce((n, u) => n + u.redate.length, 0),
      markedPaid: [...plan.updates, ...plan.settles].reduce((n, u) => n + u.markPaid.length, 0),
      reopenedInstalments: plan.updates.reduce((n, u) => n + u.reopen.length, 0),
    };
  });
}
