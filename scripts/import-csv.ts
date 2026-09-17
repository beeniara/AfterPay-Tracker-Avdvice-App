import "dotenv/config";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { and, eq } from "drizzle-orm";
import { colorSeedFor } from "@/lib/color-seed";
import { parseCsv } from "@/lib/csv";
import { assertIsoDate } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { refreshOrderStatus } from "@/lib/db/orders";
import {
  instalments,
  orders,
  payments,
  providers,
  users,
  type ProviderKind,
} from "@/lib/db/schema";
import { allocatePaid, computeOrder, generateSchedule } from "@/lib/ledger";
import { parseAmount } from "@/lib/money";

const { values: args } = parseArgs({
  options: {
    file: { type: "string" },
    provider: { type: "string" },
    kind: { type: "string", default: "bnpl" },
    currency: { type: "string", default: "NZD" },
    user: { type: "string", default: "owner@localhost" },
    instalments: { type: "string", default: "4" },
    interval: { type: "string", default: "14" },
    "dry-run": { type: "boolean", default: false },
  },
});

const REQUIRED = [
  "Date",
  "Merchant",
  "Status",
  "Channel",
  "Order No",
  "Order Amount",
  "Amount Owing",
] as const;

function usage(message: string): never {
  console.error(message);
  console.error(
    "\nUsage: pnpm import:csv --file <path.csv> --provider <name> [--kind bnpl|store_finance|loan|other] [--currency NZD] [--user email] [--instalments 4] [--interval 14] [--dry-run]",
  );
  process.exit(1);
}

async function main() {
  if (!args.file || !args.provider) usage("--file and --provider are required");
  const kind = args.kind as ProviderKind;
  const currency = args.currency!;
  const instalmentCount = Number(args.instalments);
  const intervalDays = Number(args.interval);
  const dryRun = args["dry-run"]!;

  const { headers, rows } = parseCsv(readFileSync(args.file, "utf8"));
  const missing = REQUIRED.filter((h) => !headers.includes(h));
  if (missing.length) usage(`CSV is missing columns: ${missing.join(", ")}`);

  const prepared = rows.map((row, index) => {
    const line = index + 2;
    const purchasedOn = assertIsoDate(row.Date ?? "");
    const total = parseAmount(row["Order Amount"] ?? "", currency).cents;
    const owing = parseAmount(row["Amount Owing"] ?? "", currency).cents;
    if (owing > total) throw new Error(`Line ${line}: owing exceeds total`);

    const schedule = generateSchedule({
      totalAmountCents: total,
      instalmentCount,
      firstDueOn: purchasedOn,
      intervalDays,
    });
    const paid = allocatePaid(
      schedule.map((s) => s.principalCents),
      total - owing,
    );
    const ledger = computeOrder(
      {
        totalAmountCents: total,
        refunds: [],
        instalments: schedule.map((s, i) => ({
          ...s,
          paidCents: paid[i] ?? 0,
          pendingCents: 0,
          waivedCents: 0,
          fees: [],
        })),
      },
      purchasedOn,
    );
    if (ledger.owedAmount !== owing) {
      throw new Error(`Line ${line}: reconstructed owing ${ledger.owedAmount} != ${owing}`);
    }
    const statusMismatch =
      (row.Status?.toLowerCase() === "completed") !== (owing === 0);

    return {
      line,
      merchant: row.Merchant ?? "",
      reference: row["Order No"] ?? "",
      channel: /in.?store/i.test(row.Channel ?? "") ? ("in_store" as const) : ("online" as const),
      purchasedOn,
      total,
      owing,
      schedule,
      paid,
      statusMismatch,
    };
  });

  const mismatches = prepared.filter((p) => p.statusMismatch);
  console.log(`Parsed ${prepared.length} rows from ${args.file}`);
  console.log(
    `Total: ${sumOf(prepared.map((p) => p.total))}  Owing: ${sumOf(prepared.map((p) => p.owing))}  (minor units)`,
  );
  for (const m of mismatches) {
    console.warn(`Line ${m.line}: status column disagrees with amount owing (${m.reference})`);
  }
  if (dryRun) {
    console.log("Dry run — nothing written.");
    return;
  }

  const db = getDb();
  let imported = 0;
  let skipped = 0;

  await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ email: args.user!, currency })
      .onConflictDoUpdate({ target: users.email, set: { email: args.user! } })
      .returning();

    const [provider] = await tx
      .insert(providers)
      .values({
        userId: user!.id,
        name: args.provider!,
        kind,
        colorSeed: colorSeedFor(args.provider!),
      })
      .onConflictDoUpdate({
        target: [providers.userId, providers.name],
        set: { updatedAt: new Date() },
      })
      .returning();

    for (const row of prepared) {
      const existing = await tx.query.orders.findFirst({
        where: and(eq(orders.providerId, provider!.id), eq(orders.reference, row.reference)),
        columns: { id: true },
      });
      if (existing) {
        skipped++;
        continue;
      }

      const [order] = await tx
        .insert(orders)
        .values({
          userId: user!.id,
          providerId: provider!.id,
          merchant: row.merchant,
          reference: row.reference,
          channel: row.channel,
          purchasedAt: new Date(`${row.purchasedOn}T00:00:00Z`),
          totalAmountCents: row.total,
          currency,
          instalmentCount,
        })
        .returning();

      const inserted = await tx
        .insert(instalments)
        .values(
          row.schedule.map((s, i) => ({
            orderId: order!.id,
            sequence: s.sequence,
            dueOn: s.dueOn,
            principalCents: s.principalCents,
            paidCents: row.paid[i] ?? 0,
          })),
        )
        .returning();

      const paymentRows = inserted
        .filter((i) => i.paidCents > 0)
        .map((i) => ({
          instalmentId: i.id,
          amountCents: i.paidCents,
          paidOn: i.dueOn,
          method: "card" as const,
        }));
      if (paymentRows.length) await tx.insert(payments).values(paymentRows);

      await refreshOrderStatus(tx, order!.id);
      imported++;
    }
  });

  console.log(`Imported ${imported} orders, skipped ${skipped} already present.`);
  await db.$client.end();
}

function sumOf(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
