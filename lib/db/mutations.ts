import { and, eq } from "drizzle-orm";
import { colorSeedFor } from "@/lib/color-seed";
import { generateSchedule } from "@/lib/ledger";
import type { Db, DbClient } from "./index";
import { refreshOrderStatus } from "./orders";
import {
  fees,
  instalments,
  orders,
  payments,
  providers,
  refunds,
  type Fee,
  type Order,
  type Payment,
  type Provider,
  type Refund,
} from "./schema";

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

// Drizzle wraps driver errors; the Postgres code lives on the cause.
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUniqueViolation(error.cause);
}

function positive(cents: number, what: string): number {
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new RangeError(`${what} must be a positive amount`);
  }
  return cents;
}

async function requireOrder(db: DbClient, userId: string, orderId: string): Promise<Order> {
  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, orderId), eq(orders.userId, userId)),
  });
  if (!order) throw new NotFoundError("Order not found");
  return order;
}

async function requireInstalment(db: DbClient, userId: string, instalmentId: string) {
  const row = await db.query.instalments.findFirst({
    where: eq(instalments.id, instalmentId),
    with: { order: { columns: { id: true, userId: true } } },
  });
  if (!row || row.order.userId !== userId) throw new NotFoundError("Instalment not found");
  return row;
}

async function requireProvider(db: DbClient, userId: string, providerId: string): Promise<Provider> {
  const provider = await db.query.providers.findFirst({
    where: and(eq(providers.id, providerId), eq(providers.userId, userId)),
  });
  if (!provider) throw new NotFoundError("Provider not found");
  return provider;
}

export interface CreateOrder {
  providerId: string;
  merchant: string;
  reference?: string | null;
  channel: Order["channel"];
  purchasedOn: string;
  totalAmountCents: number;
  currency: string;
  instalmentCount: number;
  firstDueOn?: string;
  intervalDays: number;
  notes?: string | null;
}

export async function createOrder(db: Db, userId: string, input: CreateOrder): Promise<string> {
  if (!Number.isInteger(input.totalAmountCents) || input.totalAmountCents < 0) {
    throw new RangeError("Order amount must be zero or more");
  }
  const schedule = generateSchedule({
    totalAmountCents: input.totalAmountCents,
    instalmentCount: input.instalmentCount,
    firstDueOn: input.firstDueOn ?? input.purchasedOn,
    intervalDays: input.intervalDays,
  });

  try {
    return await db.transaction(async (tx) => {
      await requireProvider(tx, userId, input.providerId);
      const [order] = await tx
        .insert(orders)
        .values({
          userId,
          providerId: input.providerId,
          merchant: input.merchant,
          reference: input.reference ?? null,
          channel: input.channel,
          purchasedAt: new Date(`${input.purchasedOn}T00:00:00Z`),
          totalAmountCents: input.totalAmountCents,
          currency: input.currency,
          instalmentCount: input.instalmentCount,
          notes: input.notes ?? null,
        })
        .returning({ id: orders.id });
      await tx
        .insert(instalments)
        .values(schedule.map((s) => ({ orderId: order!.id, ...s })));
      await refreshOrderStatus(tx, order!.id);
      return order!.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("An order with that reference already exists for this provider");
    }
    throw error;
  }
}

export interface PatchOrder {
  providerId?: string;
  merchant?: string;
  reference?: string | null;
  channel?: Order["channel"];
  purchasedOn?: string;
  notes?: string | null;
  cancelled?: boolean;
}

export async function updateOrder(db: Db, userId: string, orderId: string, patch: PatchOrder): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const existing = await requireOrder(tx, userId, orderId);
      if (patch.providerId) await requireProvider(tx, userId, patch.providerId);
      await tx
        .update(orders)
        .set({
          providerId: patch.providerId ?? existing.providerId,
          merchant: patch.merchant ?? existing.merchant,
          reference: patch.reference === undefined ? existing.reference : patch.reference,
          channel: patch.channel ?? existing.channel,
          purchasedAt: patch.purchasedOn
            ? new Date(`${patch.purchasedOn}T00:00:00Z`)
            : existing.purchasedAt,
          notes: patch.notes === undefined ? existing.notes : patch.notes,
          status:
            patch.cancelled === undefined
              ? existing.status
              : patch.cancelled
                ? "cancelled"
                : "active",
          updatedAt: new Date(),
        })
        .where(eq(orders.id, orderId));
      await refreshOrderStatus(tx, orderId);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("An order with that reference already exists for this provider");
    }
    throw error;
  }
}

export async function deleteOrder(db: Db, userId: string, orderId: string): Promise<void> {
  await requireOrder(db, userId, orderId);
  await db.delete(orders).where(eq(orders.id, orderId));
}

export interface RecordPayment {
  amountCents: number;
  paidOn: string;
  method: Payment["method"];
  reference?: string | null;
  pending?: boolean;
}

// A pending payment is money taken but not cleared. A later cleared payment on
// the same instalment first consumes the pending balance.
export async function recordPayment(
  db: Db,
  userId: string,
  instalmentId: string,
  input: RecordPayment,
): Promise<void> {
  const amount = positive(input.amountCents, "Payment");
  await db.transaction(async (tx) => {
    const inst = await requireInstalment(tx, userId, instalmentId);
    if (input.pending) {
      await tx
        .update(instalments)
        .set({ pendingCents: inst.pendingCents + amount, updatedAt: new Date() })
        .where(eq(instalments.id, instalmentId));
    } else {
      const clearedPending = Math.min(inst.pendingCents, amount);
      await tx
        .update(instalments)
        .set({
          paidCents: inst.paidCents + amount,
          pendingCents: inst.pendingCents - clearedPending,
          updatedAt: new Date(),
        })
        .where(eq(instalments.id, instalmentId));
      await tx.insert(payments).values({
        instalmentId,
        amountCents: amount,
        paidOn: input.paidOn,
        method: input.method,
        reference: input.reference ?? null,
      });
    }
    await refreshOrderStatus(tx, inst.orderId);
  });
}

export interface RecordFee {
  amountCents: number;
  kind: Fee["kind"];
  incurredOn: string;
  note?: string | null;
}

export async function recordFee(db: Db, userId: string, instalmentId: string, input: RecordFee): Promise<void> {
  const amount = positive(input.amountCents, "Fee");
  await db.transaction(async (tx) => {
    const inst = await requireInstalment(tx, userId, instalmentId);
    await tx.insert(fees).values({
      instalmentId,
      amountCents: amount,
      kind: input.kind,
      incurredOn: input.incurredOn,
      note: input.note ?? null,
    });
    await tx
      .update(instalments)
      .set({ updatedAt: new Date() })
      .where(eq(instalments.id, instalmentId));
    await refreshOrderStatus(tx, inst.orderId);
  });
}

export interface RecordRefund {
  amountCents: number;
  refundedOn: string;
  note?: string | null;
}

export async function recordRefund(db: Db, userId: string, orderId: string, input: RecordRefund): Promise<Refund> {
  const amount = positive(input.amountCents, "Refund");
  return db.transaction(async (tx) => {
    await requireOrder(tx, userId, orderId);
    const [refund] = await tx
      .insert(refunds)
      .values({ orderId, amountCents: amount, refundedOn: input.refundedOn, note: input.note ?? null })
      .returning();
    await refreshOrderStatus(tx, orderId);
    return refund!;
  });
}

export interface ProviderFields {
  name: string;
  kind: Provider["kind"];
  website?: string | null;
  supportPhone?: string | null;
  notes?: string | null;
}

export async function createProvider(db: Db, userId: string, input: ProviderFields): Promise<Provider> {
  try {
    const [provider] = await db
      .insert(providers)
      .values({
        userId,
        name: input.name,
        kind: input.kind,
        website: input.website ?? null,
        supportPhone: input.supportPhone ?? null,
        notes: input.notes ?? null,
        colorSeed: colorSeedFor(input.name),
      })
      .returning();
    return provider!;
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("You already have a provider with that name");
    throw error;
  }
}

export async function updateProvider(
  db: Db,
  userId: string,
  providerId: string,
  input: Partial<ProviderFields>,
): Promise<Provider> {
  const existing = await requireProvider(db, userId, providerId);
  try {
    const [provider] = await db
      .update(providers)
      .set({
        name: input.name ?? existing.name,
        kind: input.kind ?? existing.kind,
        website: input.website === undefined ? existing.website : input.website,
        supportPhone: input.supportPhone === undefined ? existing.supportPhone : input.supportPhone,
        notes: input.notes === undefined ? existing.notes : input.notes,
        updatedAt: new Date(),
      })
      .where(eq(providers.id, providerId))
      .returning();
    return provider!;
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("You already have a provider with that name");
    throw error;
  }
}

export async function deleteProvider(db: Db, userId: string, providerId: string): Promise<void> {
  await requireProvider(db, userId, providerId);
  const inUse = await db.query.orders.findFirst({
    where: eq(orders.providerId, providerId),
    columns: { id: true },
  });
  if (inUse) throw new ConflictError("Delete or move this provider's orders first");
  await db.delete(providers).where(eq(providers.id, providerId));
}
