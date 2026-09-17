import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "./index";
import {
  ConflictError,
  createOrder,
  createProvider,
  deleteOrder,
  deleteProvider,
  NotFoundError,
  recordFee,
  recordPayment,
  recordRefund,
  updateOrder,
} from "./mutations";
import { getOrder } from "./queries";
import { users } from "./schema";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("mutations", () => {
  let db: Db;
  let userId: string;
  let providerId: string;
  const today = "2026-09-17";

  beforeAll(async () => {
    db = createDb(url, 1);
    const [user] = await db
      .insert(users)
      .values({ email: `mutations-${crypto.randomUUID()}@example.test` })
      .returning();
    userId = user!.id;
    providerId = (await createProvider(db, userId, { name: "Northwind Pay", kind: "bnpl" })).id;
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, userId));
    await db.$client.end();
  });

  async function newOrder(overrides: Partial<Parameters<typeof createOrder>[2]> = {}) {
    return createOrder(db, userId, {
      providerId,
      merchant: "Glimmer Goods",
      channel: "online",
      purchasedOn: "2026-09-01",
      totalAmountCents: 10000,
      currency: "NZD",
      instalmentCount: 4,
      intervalDays: 14,
      ...overrides,
    });
  }

  it("creates an order with a generated schedule and active status", async () => {
    const id = await newOrder();
    const order = (await getOrder(db, userId, id, today))!;
    expect(order.status).toBe("active");
    expect(order.ledger.instalments.map((i) => [i.dueOn, i.principalCents])).toEqual([
      ["2026-09-01", 2500],
      ["2026-09-15", 2500],
      ["2026-09-29", 2500],
      ["2026-10-13", 2500],
    ]);
    expect(order.ledger.instalments.map((i) => i.state)).toEqual([
      "overdue",
      "overdue",
      "upcoming",
      "upcoming",
    ]);
  });

  it("rejects duplicate references per provider and unknown providers", async () => {
    await newOrder({ reference: "DUP-1" });
    await expect(newOrder({ reference: "DUP-1" })).rejects.toThrow(ConflictError);
    await expect(newOrder({ providerId: crypto.randomUUID() })).rejects.toThrow(NotFoundError);
  });

  it("records payments, clears pending money and settles the order", async () => {
    const id = await newOrder();
    const [first, second, third, fourth] = (await getOrder(db, userId, id, today))!.instalments;

    await recordPayment(db, userId, first!.id, { amountCents: 2500, paidOn: "2026-09-01", method: "card" });
    await recordPayment(db, userId, second!.id, {
      amountCents: 2500,
      paidOn: "2026-09-15",
      method: "card",
      pending: true,
    });
    let order = (await getOrder(db, userId, id, today))!;
    expect(order.ledger).toMatchObject({
      totalPaid: 2500,
      pendingAmount: 2500,
      owedAmount: 7500,
      owedWithoutPending: 5000,
      status: "active",
    });
    expect(order.ledger.instalments[1]?.state).toBe("pending");

    await recordPayment(db, userId, second!.id, { amountCents: 2500, paidOn: "2026-09-16", method: "card" });
    order = (await getOrder(db, userId, id, today))!;
    expect(order.ledger.instalments[1]).toMatchObject({ paidCents: 2500, pendingCents: 0, state: "paid" });

    await recordPayment(db, userId, third!.id, { amountCents: 2500, paidOn: "2026-09-17", method: "bank" });
    await recordPayment(db, userId, fourth!.id, { amountCents: 2500, paidOn: "2026-09-17", method: "bank" });
    order = (await getOrder(db, userId, id, today))!;
    expect(order.status).toBe("settled");
    expect(order.ledger).toMatchObject({ owedAmount: 0, trueCost: 10000, status: "settled" });
    expect(order.instalments.flatMap((i) => i.payments)).toHaveLength(4);
  });

  it("fees reopen an order and refunds reduce true cost", async () => {
    const id = await newOrder({ totalAmountCents: 4000, instalmentCount: 2 });
    const [a, b] = (await getOrder(db, userId, id, today))!.instalments;
    await recordPayment(db, userId, a!.id, { amountCents: 2000, paidOn: "2026-09-01", method: "card" });
    await recordPayment(db, userId, b!.id, { amountCents: 2000, paidOn: "2026-09-15", method: "card" });
    expect((await getOrder(db, userId, id, today))!.status).toBe("settled");

    await recordFee(db, userId, b!.id, { amountCents: 1000, kind: "late", incurredOn: "2026-09-16" });
    let order = (await getOrder(db, userId, id, today))!;
    expect(order.status).toBe("active");
    expect(order.ledger).toMatchObject({ totalFees: 1000, owedAmount: 1000, trueCost: 5000 });

    await recordRefund(db, userId, id, { amountCents: 500, refundedOn: "2026-09-17" });
    order = (await getOrder(db, userId, id, today))!;
    expect(order.ledger).toMatchObject({ amountRefunded: 500, totalAfterRefunds: 3500, trueCost: 4500 });
  });

  it("rejects non-positive money", async () => {
    const id = await newOrder();
    const [first] = (await getOrder(db, userId, id, today))!.instalments;
    await expect(
      recordPayment(db, userId, first!.id, { amountCents: 0, paidOn: today, method: "card" }),
    ).rejects.toThrow(RangeError);
    await expect(
      recordFee(db, userId, first!.id, { amountCents: -5, kind: "late", incurredOn: today }),
    ).rejects.toThrow(RangeError);
  });

  it("updates, cancels and deletes orders", async () => {
    const id = await newOrder();
    await updateOrder(db, userId, id, { merchant: "Cobalt Kitchenware", cancelled: true });
    let order = (await getOrder(db, userId, id, today))!;
    expect(order.merchant).toBe("Cobalt Kitchenware");
    expect(order.status).toBe("cancelled");
    await updateOrder(db, userId, id, { cancelled: false });
    order = (await getOrder(db, userId, id, today))!;
    expect(order.status).toBe("active");

    await deleteOrder(db, userId, id);
    expect(await getOrder(db, userId, id, today)).toBeNull();
    await expect(deleteOrder(db, userId, id)).rejects.toThrow(NotFoundError);
  });

  it("refuses to delete a provider that still has orders", async () => {
    const provider = await createProvider(db, userId, { name: "Quartz Pay", kind: "bnpl" });
    await expect(createProvider(db, userId, { name: "Quartz Pay", kind: "loan" })).rejects.toThrow(
      ConflictError,
    );
    const id = await newOrder({ providerId: provider.id });
    await expect(deleteProvider(db, userId, provider.id)).rejects.toThrow(ConflictError);
    await deleteOrder(db, userId, id);
    await deleteProvider(db, userId, provider.id);
  });
});
