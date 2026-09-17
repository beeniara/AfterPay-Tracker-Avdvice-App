import "dotenv/config";
import { parseArgs } from "node:util";
import { count } from "drizzle-orm";
import { addDays, todayIso } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { createOrder, createProvider, recordFee, recordPayment, recordRefund } from "@/lib/db/mutations";
import { getOrder } from "@/lib/db/queries";
import { users, type ProviderKind } from "@/lib/db/schema";

// Demo data for empty databases. Every name here is invented.
const PROVIDERS: { name: string; kind: ProviderKind }[] = [
  { name: "Northwind Pay", kind: "bnpl" },
  { name: "Glimmer Credit", kind: "bnpl" },
  { name: "Quartz Pay", kind: "bnpl" },
  { name: "Tidewater Instalments", kind: "bnpl" },
  { name: "Harbourline Finance", kind: "store_finance" },
  { name: "Lantern Store Plan", kind: "store_finance" },
  { name: "Pebble Loans", kind: "loan" },
  { name: "Marigold Money", kind: "other" },
];

const MERCHANTS = [
  "Glimmer Goods",
  "Cobalt Kitchenware",
  "Fernway Pharmacy",
  "Deliverish",
  "Oakleaf Hardware",
  "Pixel & Pine Electronics",
  "Saffron Street Eats",
  "Brightside Books",
  "Northlake Outdoors",
  "Velvet Threads",
];

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const { values: args } = parseArgs({
  options: {
    force: { type: "boolean", default: false },
    user: { type: "string", default: "demo@localhost" },
  },
});

async function main() {
  const db = getDb();
  const [existing] = await db.select({ value: count() }).from(users);
  if ((existing?.value ?? 0) > 0 && !args.force) {
    console.error("Database already has data. Pass --force to seed anyway.");
    process.exit(1);
  }

  const [user] = await db
    .insert(users)
    .values({ email: args.user!, name: "Demo Person" })
    .onConflictDoUpdate({ target: users.email, set: { name: "Demo Person" } })
    .returning();
  const userId = user!.id;
  const today = todayIso();
  const random = rng(20260917);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;

  const providers = [];
  for (const p of PROVIDERS) providers.push(await createProvider(db, userId, p));

  let created = 0;
  for (let n = 0; n < 40; n++) {
    const provider = pick(providers);
    const daysAgo = Math.floor(random() * 730);
    const purchasedOn = addDays(today, -daysAgo);
    const total = 1500 + Math.floor(random() * 60000);
    const instalmentCount = provider.kind === "loan" ? 12 : provider.kind === "store_finance" ? 6 : 4;
    const intervalDays = provider.kind === "loan" ? 30 : 14;

    const id = await createOrder(db, userId, {
      providerId: provider.id,
      merchant: pick(MERCHANTS),
      reference: `${provider.name.slice(0, 2).toUpperCase()}-${100000 + n}`,
      channel: random() < 0.5 ? "online" : "in_store",
      purchasedOn,
      totalAmountCents: total,
      currency: "NZD",
      instalmentCount,
      intervalDays,
    });
    created++;

    const order = (await getOrder(db, userId, id, today))!;
    const missOne = random() < 0.15;
    for (const inst of order.instalments) {
      const due = inst.dueOn;
      if (due > today) continue;
      if (missOne && inst.sequence === 2) {
        // Overdue with a late fee, so the seed has attention-worthy rows.
        await recordFee(db, userId, inst.id, { amountCents: 1000, kind: "late", incurredOn: addDays(due, 1) });
        continue;
      }
      await recordPayment(db, userId, inst.id, {
        amountCents: inst.principalCents,
        paidOn: due,
        method: random() < 0.8 ? "card" : "bank",
      });
    }
    if (n % 13 === 0) {
      await recordRefund(db, userId, id, { amountCents: Math.floor(total / 4), refundedOn: addDays(purchasedOn, 10), note: "Item returned" });
    }
    if (n === 7) {
      const pending = order.instalments.find((i) => i.dueOn > today);
      if (pending) {
        await recordPayment(db, userId, pending.id, { amountCents: pending.principalCents, paidOn: today, method: "card", pending: true });
      }
    }
  }

  console.log(`Seeded ${providers.length} providers and ${created} orders for ${args.user}.`);
  await db.$client.end();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
