import { eq } from "drizzle-orm";
import { todayIso } from "@/lib/dates";
import { computeOrder, type OrderStatus } from "@/lib/ledger";
import type { DbClient } from "./index";
import { orders } from "./schema";

export async function loadOrderWithLedger(
  db: DbClient,
  orderId: string,
  today: string = todayIso(),
) {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    with: {
      provider: true,
      instalments: {
        with: { fees: true, payments: true },
        orderBy: (i, { asc }) => [asc(i.sequence)],
      },
      refunds: true,
    },
  });
  if (!order) return null;

  const ledger = computeOrder(
    {
      totalAmountCents: order.totalAmountCents,
      instalments: order.instalments,
      refunds: order.refunds,
      cancelled: order.status === "cancelled",
    },
    today,
  );
  return { order, ledger };
}

// The only place the cached orders.status column is ever written.
export async function refreshOrderStatus(
  db: DbClient,
  orderId: string,
  today: string = todayIso(),
): Promise<OrderStatus> {
  const loaded = await loadOrderWithLedger(db, orderId, today);
  if (!loaded) throw new Error(`Order ${orderId} not found`);

  const { order, ledger } = loaded;
  if (ledger.status !== order.status) {
    await db
      .update(orders)
      .set({ status: ledger.status, updatedAt: new Date() })
      .where(eq(orders.id, orderId));
  }
  return ledger.status;
}
