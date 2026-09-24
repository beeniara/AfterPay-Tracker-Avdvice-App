import "dotenv/config";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parseCsv } from "@/lib/csv";
import { todayIso } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { commitUpcoming, prepareUpcoming, type UpcomingPlan } from "@/lib/import/upcoming";

// Reconciles a provider's upcoming-payments export against the database. Past
// orders are never deleted; see lib/import/upcoming.ts for what changes.
const { values: args } = parseArgs({
  options: {
    file: { type: "string" },
    provider: { type: "string" },
    currency: { type: "string", default: "NZD" },
    user: { type: "string", default: "owner@localhost" },
    interval: { type: "string", default: "14" },
    "keep-missing": { type: "boolean", default: false },
    "skip-settled": { type: "boolean", default: false },
    "no-create": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

const COLUMNS = {
  merchant: "Merchant",
  paymentNo: "Payment no.",
  dueDate: "Due date",
} as const;

function usage(message: string): never {
  console.error(message);
  console.error(
    "\nUsage: pnpm import:upcoming --file <path.csv> --provider <name> [--currency NZD] [--user email] [--interval 14] [--keep-missing] [--skip-settled] [--no-create] [--dry-run]",
  );
  process.exit(1);
}

function report(plan: UpcomingPlan): void {
  console.log(
    `${plan.rows.length} instalments in ${plan.chains.length} orders; export says ${plan.upcomingCents} still to pay. Owing ${plan.owingBefore} → ${plan.owingAfter} (minor units)`,
  );
  for (const u of plan.updates) {
    const what = [
      u.redate.length ? `${u.redate.length} re-dated` : "",
      u.markPaid.length ? `${u.markPaid.length} marked paid` : "",
      u.reopen.length ? `${u.reopen.length} re-opened` : "",
    ].filter(Boolean);
    if (what.length) console.log(`${u.wasSettled ? "REOPEN " : "UPDATE "} ${u.merchant} ${u.reference ?? "-"} (${u.purchasedOn}): ${what.join(", ")}`);
  }
  for (const s of plan.settles) console.log(`SETTLE  ${s.merchant} ${s.reference ?? "-"} (${s.purchasedOn}): ${s.markPaid.length} marked paid`);
  for (const c of plan.creates) console.log(`CREATE  ${c.merchant} (~${c.purchasedOn}): total ~${c.totalAmountCents}, owing ${c.owing}, lines ${c.lines.join(",")}`);
}

async function main() {
  if (!args.file || !args.provider) usage("--file and --provider are required");

  const { headers, rows } = parseCsv(readFileSync(args.file, "utf8"));
  const missing = Object.values(COLUMNS).filter((h) => !headers.includes(h));
  if (missing.length) usage(`CSV is missing columns: ${missing.join(", ")}`);
  const amountHeader = headers.find((h) => /^amount/i.test(h));
  if (!amountHeader) usage("CSV has no Amount column");

  const inputs = rows.map((r) => ({
    merchant: r[COLUMNS.merchant] ?? "",
    paymentNo: r[COLUMNS.paymentNo] ?? "",
    dueDate: r[COLUMNS.dueDate] ?? "",
    amount: r[amountHeader] ?? "",
  }));
  const options = {
    providerName: args.provider,
    currency: args.currency!,
    intervalDays: Number(args.interval),
    settleMissing: !args["keep-missing"],
    reopenSettled: !args["skip-settled"],
    createUnmatched: !args["no-create"],
  };

  const db = getDb();
  const [user] = await db
    .insert(users)
    .values({ email: args.user!, currency: options.currency })
    .onConflictDoUpdate({ target: users.email, set: { email: args.user! } })
    .returning();
  const today = todayIso(user!.timeZone);

  const plan = await prepareUpcoming(db, user!.id, inputs, options, today);
  for (const e of plan.errors) console.warn(`Line ${e.line}: ${e.message}`);
  report(plan);
  if (plan.errors.length) {
    console.error("Fix the rows above and re-run.");
    process.exit(1);
  }
  if (args["dry-run"]) {
    console.log("Dry run — nothing written.");
  } else {
    const r = await commitUpcoming(db, user!.id, inputs, options, today);
    console.log(
      `Updated ${r.updated}, re-opened ${r.reopened}, added ${r.created}, paid off ${r.settled}; ${r.redated} instalments re-dated, ${r.markedPaid} marked paid, ${r.reopenedInstalments} re-opened.`,
    );
  }
  await db.$client.end();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
