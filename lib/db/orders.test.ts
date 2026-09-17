import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeOrder } from "@/lib/ledger";
import { createDb, type Db } from "./index";
import { loadOrderWithLedger, refreshOrderStatus } from "./orders";
import { instalments, orders, providers, users } from "./schema";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("orders.status cache", () => {
  let db: Db;
  let userId: string;
  let orderId: string;
  const today = "2026-06-01";

  beforeAll(async () => {
    db = createDb(url, 1);
    await migrate(db, { migrationsFolder: "drizzle" });

    const [user] = await db
      .insert(users)
      .values({ email: `status-test-${crypto.randomUUID()}@example.test` })
      .returning();
    userId = user!.id;

    const [provider] = await db
      .insert(providers)
      .values({ userId, name: "Test provider" })
      .returning();

    const [order] = await db
      .insert(orders)
      .values({
        userId,
        providerId: provider!.id,
        merchant: "Test merchant",
        channel: "online",
        purchasedAt: new Date("2026-05-01T00:00:00Z"),
        totalAmountCents: 4000,
        currency: "NZD",
        instalmentCount: 2,
        status: "settled", // deliberately wrong
      })
      .returning();
    orderId = order!.id;

    await db.insert(instalments).values([
      { orderId, sequence: 1, dueOn: "2026-05-01", principalCents: 2000, paidCents: 2000 },
      { orderId, sequence: 2, dueOn: "2026-05-15", principalCents: 2000 },
    ]);
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, userId));
    await db.$client.end();
  });

  async function cachedStatus() {
    const row = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    return row!.status;
  }

  it("corrects a cache that disagrees with the ledger", async () => {
    expect(await cachedStatus()).toBe("settled");
    expect(await refreshOrderStatus(db, orderId, today)).toBe("active");
    expect(await cachedStatus()).toBe("active");
  });

  it("matches the computed status after money moves", async () => {
    await db
      .update(instalments)
      .set({ paidCents: 2000 })
      .where(eq(instalments.orderId, orderId));
    await refreshOrderStatus(db, orderId, today);

    const loaded = await loadOrderWithLedger(db, orderId, today);
    const recomputed = computeOrder(
      {
        totalAmountCents: loaded!.order.totalAmountCents,
        instalments: loaded!.order.instalments,
        refunds: loaded!.order.refunds,
      },
      today,
    );
    expect(await cachedStatus()).toBe(recomputed.status);
    expect(recomputed.status).toBe("settled");
  });

  it("throws for an unknown order", async () => {
    await expect(
      refreshOrderStatus(db, crypto.randomUUID(), today),
    ).rejects.toThrow(/not found/);
  });
});
