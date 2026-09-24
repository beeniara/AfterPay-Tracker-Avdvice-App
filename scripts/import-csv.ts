import "dotenv/config";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parseCsv } from "@/lib/csv";
import { assertIsoDate, todayIso } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { users, type ProviderKind } from "@/lib/db/schema";
import { commitImport, prepareImport } from "@/lib/import/orders";

const { values: args } = parseArgs({
  options: {
    file: { type: "string" },
    provider: { type: "string" },
    kind: { type: "string", default: "bnpl" },
    currency: { type: "string", default: "NZD" },
    user: { type: "string", default: "owner@localhost" },
    instalments: { type: "string", default: "4" },
    interval: { type: "string", default: "14" },
    // A cycle day (YYYY-MM-DD) for providers that collect on fixed fortnightly
    // days; the first instalment then falls on the last cycle day on or before
    // purchase + interval. Omit for schedules that start on the purchase date.
    "cycle-anchor": { type: "string" },
    replace: { type: "boolean", default: false },
    // Skip orders already present instead of updating them to the export's owing.
    "no-update": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

// Each column may appear under any of these headers (older and newer export formats).
const COLUMNS = {
  date: ["Date", "Purchase date"],
  merchant: ["Merchant"],
  status: ["Status"],
  channel: ["Channel"],
  reference: ["Order No", "Order no."],
  totalAmount: ["Order Amount", "Order amount (NZD)"],
  amountOwing: ["Amount Owing", "Amount owing (NZD)"],
} as const;
const OPTIONAL = new Set<keyof typeof COLUMNS>(["status", "channel"]);

function usage(message: string): never {
  console.error(message);
  console.error(
    "\nUsage: pnpm import:csv --file <path.csv> --provider <name> [--kind bnpl|store_finance|loan|other] [--currency NZD] [--user email] [--instalments 4] [--interval 14] [--cycle-anchor YYYY-MM-DD] [--replace] [--no-update] [--dry-run]",
  );
  process.exit(1);
}

async function main() {
  if (!args.file || !args.provider) usage("--file and --provider are required");

  const { headers, rows } = parseCsv(readFileSync(args.file, "utf8"));
  const col = Object.fromEntries(
    (Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]).map((key) => [
      key,
      COLUMNS[key].find((h) => headers.some((x) => x.toLowerCase() === h.toLowerCase())),
    ]),
  ) as Record<keyof typeof COLUMNS, string | undefined>;
  const missing = (Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]).filter((k) => !OPTIONAL.has(k) && !col[k]);
  if (missing.length) usage(`CSV is missing columns: ${missing.map((k) => COLUMNS[k].join(" / ")).join(", ")}`);
  const cell = (r: Record<string, string>, key: keyof typeof COLUMNS): string | undefined => {
    const header = col[key];
    if (!header) return undefined;
    return r[Object.keys(r).find((h) => h.toLowerCase() === header.toLowerCase()) ?? header];
  };

  const options = {
    providerName: args.provider,
    providerKind: args.kind as ProviderKind,
    currency: args.currency!,
    instalmentCount: Number(args.instalments),
    intervalDays: Number(args.interval),
    cycleAnchor: args["cycle-anchor"] ? assertIsoDate(args["cycle-anchor"]) : undefined,
    replace: args.replace!,
    updateExisting: !args["no-update"],
  };
  const plan = prepareImport(
    rows.map((r) => ({
      date: cell(r, "date") ?? "",
      merchant: cell(r, "merchant") ?? "",
      status: cell(r, "status"),
      channel: cell(r, "channel"),
      reference: cell(r, "reference") ?? "",
      totalAmount: cell(r, "totalAmount") ?? "",
      amountOwing: cell(r, "amountOwing") ?? "",
    })),
    options,
  );

  console.log(`Parsed ${rows.length} rows from ${args.file}: ${plan.rows.length} valid, ${plan.errors.length} with errors`);
  console.log(`Total: ${plan.totalCents}  Owing: ${plan.owingCents}  (minor units)`);
  for (const e of plan.errors) console.warn(`Line ${e.line}: ${e.message}`);
  if (plan.statusMismatches) console.warn(`${plan.statusMismatches} rows where the status column disagrees with the amount owing`);
  if (plan.errors.length) {
    console.error("Fix the rows above and re-run.");
    process.exit(1);
  }
  if (args["dry-run"]) {
    console.log("Dry run — nothing written.");
    return;
  }

  const db = getDb();
  const [user] = await db
    .insert(users)
    .values({ email: args.user!, currency: options.currency })
    .onConflictDoUpdate({ target: users.email, set: { email: args.user! } })
    .returning();
  const result = await commitImport(db, user!.id, plan, options, todayIso(user!.timeZone));
  console.log(`Imported ${result.imported} orders, updated ${result.updated} already present, ${result.skipped} unchanged.`);
  await db.$client.end();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
