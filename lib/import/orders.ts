import { and, eq } from "drizzle-orm";
import { colorSeedFor } from "@/lib/color-seed";
import { addDays, isIsoDate } from "@/lib/dates";
import type { Db } from "@/lib/db";
import { refreshOrderStatus } from "@/lib/db/orders";
import { instalments, orders, payments, providers, type ProviderKind } from "@/lib/db/schema";
import { alignToCycle, allocatePaid, computeOrder, generateSchedule, type ScheduledInstalment } from "@/lib/ledger";
import { parseAmount } from "@/lib/money";

export interface ImportRowInput {
  date: string;
  merchant: string;
  reference: string;
  totalAmount: string;
  amountOwing: string;
  channel?: string;
  status?: string;
}

export interface ImportOptions {
  providerName: string;
  providerKind: ProviderKind;
  currency: string;
  instalmentCount: number;
  intervalDays: number;
  cycleAnchor?: string;
  replace: boolean;
}

export interface PreparedRow {
  line: number;
  merchant: string;
  reference: string;
  channel: "online" | "in_store";
  purchasedOn: string;
  total: number;
  owing: number;
  schedule: ScheduledInstalment[];
  paid: number[];
  statusMismatch: boolean;
}

export interface ImportPlan {
  rows: PreparedRow[];
  errors: { line: number; message: string }[];
  totalCents: number;
  owingCents: number;
  statusMismatches: number;
}

function normaliseDate(value: string): string | null {
  const trimmed = value.trim();
  if (isIsoDate(trimmed)) return trimmed;
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(trimmed);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
  const ymd = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(trimmed);
  if (ymd) return `${ymd[1]}-${ymd[2]!.padStart(2, "0")}-${ymd[3]!.padStart(2, "0")}`;
  return null;
}

// Validates and reconstructs every row without touching the database.
export function prepareImport(rows: readonly ImportRowInput[], options: ImportOptions): ImportPlan {
  const prepared: PreparedRow[] = [];
  const errors: ImportPlan["errors"] = [];
  const seen = new Set<string>();

  rows.forEach((row, index) => {
    const line = index + 2;
    try {
      const purchasedOn = normaliseDate(row.date);
      if (!purchasedOn) throw new Error(`Unrecognised date "${row.date}"`);
      const merchant = row.merchant.trim();
      if (!merchant) throw new Error("Merchant is empty");
      const reference = row.reference.trim();
      if (!reference) throw new Error("Order number is empty");
      if (seen.has(reference)) throw new Error(`Duplicate order number ${reference}`);
      seen.add(reference);

      const total = parseAmount(row.totalAmount, options.currency).cents;
      const owing = parseAmount(row.amountOwing, options.currency).cents;
      if (total < 0) throw new Error("Order amount is negative");
      if (owing < 0 || owing > total) throw new Error("Amount owing must be between 0 and the order amount");

      const firstDueOn = options.cycleAnchor
        ? alignToCycle(addDays(purchasedOn, options.intervalDays), options.cycleAnchor, options.intervalDays)
        : purchasedOn;
      const schedule = generateSchedule({
        totalAmountCents: total,
        instalmentCount: options.instalmentCount,
        firstDueOn,
        intervalDays: options.intervalDays,
      });
      const paid = allocatePaid(schedule.map((s) => s.principalCents), total - owing);
      const ledger = computeOrder(
        {
          totalAmountCents: total,
          refunds: [],
          instalments: schedule.map((s, i) => ({ ...s, paidCents: paid[i] ?? 0, pendingCents: 0, waivedCents: 0, fees: [] })),
        },
        purchasedOn,
      );
      if (ledger.owedAmount !== owing) throw new Error(`Reconstructed owing ${ledger.owedAmount} does not match ${owing}`);

      const status = row.status?.trim().toLowerCase();
      prepared.push({
        line,
        merchant,
        reference,
        channel: /in.?store/i.test(row.channel ?? "") ? "in_store" : "online",
        purchasedOn,
        total,
        owing,
        schedule,
        paid,
        statusMismatch: status ? (status === "completed" || status === "paid") !== (owing === 0) : false,
      });
    } catch (error) {
      errors.push({ line, message: error instanceof Error ? error.message : String(error) });
    }
  });

  return {
    rows: prepared,
    errors,
    totalCents: prepared.reduce((sum, r) => sum + r.total, 0),
    owingCents: prepared.reduce((sum, r) => sum + r.owing, 0),
    statusMismatches: prepared.filter((r) => r.statusMismatch).length,
  };
}

export interface ImportResult {
  providerId: string;
  imported: number;
  skipped: number;
}

export async function commitImport(
  db: Db,
  userId: string,
  plan: ImportPlan,
  options: ImportOptions,
): Promise<ImportResult> {
  return db.transaction(async (tx) => {
    const [provider] = await tx
      .insert(providers)
      .values({
        userId,
        name: options.providerName,
        kind: options.providerKind,
        colorSeed: colorSeedFor(options.providerName),
      })
      .onConflictDoUpdate({ target: [providers.userId, providers.name], set: { updatedAt: new Date() } })
      .returning();
    const providerId = provider!.id;

    if (options.replace) await tx.delete(orders).where(eq(orders.providerId, providerId));

    let imported = 0;
    let skipped = 0;
    for (const row of plan.rows) {
      const existing = await tx.query.orders.findFirst({
        where: and(eq(orders.providerId, providerId), eq(orders.reference, row.reference)),
        columns: { id: true },
      });
      if (existing) {
        skipped++;
        continue;
      }
      const [order] = await tx
        .insert(orders)
        .values({
          userId,
          providerId,
          merchant: row.merchant,
          reference: row.reference,
          channel: row.channel,
          purchasedAt: new Date(`${row.purchasedOn}T00:00:00Z`),
          totalAmountCents: row.total,
          currency: options.currency,
          instalmentCount: options.instalmentCount,
        })
        .returning({ id: orders.id });
      const inserted = await tx
        .insert(instalments)
        .values(row.schedule.map((s, i) => ({ orderId: order!.id, ...s, paidCents: row.paid[i] ?? 0 })))
        .returning();
      const paymentRows = inserted
        .filter((i) => i.paidCents > 0)
        .map((i) => ({ instalmentId: i.id, amountCents: i.paidCents, paidOn: i.dueOn, method: "card" as const }));
      if (paymentRows.length) await tx.insert(payments).values(paymentRows);
      await refreshOrderStatus(tx, order!.id);
      imported++;
    }
    return { providerId, imported, skipped };
  });
}
