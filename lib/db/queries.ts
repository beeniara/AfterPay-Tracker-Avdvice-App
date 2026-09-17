import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  type SQL,
} from "drizzle-orm";
import type { OrderListQuery } from "@/lib/api/params";
import { todayIso } from "@/lib/dates";
import {
  computeOrder,
  dueWithin,
  overdueTotal,
  type LedgerInstalment,
  type OrderLedger,
} from "@/lib/ledger";
import type { DbClient } from "./index";
import {
  instalments,
  orders,
  providers,
  type Fee,
  type Instalment,
  type Order,
  type Provider,
  type Refund,
} from "./schema";

export type InstalmentWithFees = Instalment & { fees: Fee[] };
export type OrderRow = Order & {
  provider: Provider;
  instalments: InstalmentWithFees[];
  refunds: Refund[];
};
export type OrderWithLedger = OrderRow & { ledger: OrderLedger<InstalmentWithFees> };

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function contains(column: Parameters<typeof ilike>[0], value: string): SQL {
  return ilike(column, `%${escapeLike(value)}%`);
}

function orderFilterWhere(userId: string, q: OrderListQuery): SQL | undefined {
  return and(
    eq(orders.userId, userId),
    q.merchant ? contains(orders.merchant, q.merchant) : undefined,
    q.providerId ? eq(orders.providerId, q.providerId) : undefined,
    q.status ? eq(orders.status, q.status) : undefined,
    q.from ? gte(orders.purchasedAt, new Date(`${q.from}T00:00:00Z`)) : undefined,
    q.to ? lte(orders.purchasedAt, new Date(`${q.to}T23:59:59.999Z`)) : undefined,
    q.q
      ? or(
          contains(orders.merchant, q.q),
          contains(orders.reference, q.q),
          contains(providers.name, q.q),
        )
      : undefined,
  );
}

const SORT_COLUMNS = {
  purchasedAt: orders.purchasedAt,
  merchant: orders.merchant,
  totalAmountCents: orders.totalAmountCents,
  status: orders.status,
} as const;

export function withLedger(row: OrderRow, today: string): OrderWithLedger {
  return {
    ...row,
    ledger: computeOrder(
      {
        totalAmountCents: row.totalAmountCents,
        instalments: row.instalments,
        refunds: row.refunds,
        cancelled: row.status === "cancelled",
      },
      today,
    ),
  };
}

export async function listOrders(
  db: DbClient,
  userId: string,
  query: OrderListQuery,
  today: string = todayIso(),
): Promise<{ totalResults: number; results: OrderWithLedger[] }> {
  const where = orderFilterWhere(userId, query);
  const sortColumn = SORT_COLUMNS[query.orderBy];
  const direction = query.ascending ? asc : desc;

  const [[total], ids] = await Promise.all([
    db
      .select({ value: count() })
      .from(orders)
      .innerJoin(providers, eq(orders.providerId, providers.id))
      .where(where),
    db
      .select({ id: orders.id })
      .from(orders)
      .innerJoin(providers, eq(orders.providerId, providers.id))
      .where(where)
      .orderBy(direction(sortColumn), desc(orders.createdAt))
      .offset(query.offset)
      .limit(query.limit),
  ]);

  const orderIds = ids.map((row) => row.id);
  if (orderIds.length === 0) return { totalResults: total?.value ?? 0, results: [] };

  const rows = await db.query.orders.findMany({
    where: inArray(orders.id, orderIds),
    with: {
      provider: true,
      instalments: { with: { fees: true } },
      refunds: true,
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const results = orderIds
    .map((id) => byId.get(id))
    .filter((row): row is OrderRow => row !== undefined)
    .map((row) => withLedger(row, today));

  return { totalResults: total?.value ?? 0, results };
}

export async function getOrder(
  db: DbClient,
  userId: string,
  orderId: string,
  today: string = todayIso(),
) {
  const row = await db.query.orders.findFirst({
    where: and(eq(orders.id, orderId), eq(orders.userId, userId)),
    with: {
      provider: true,
      instalments: {
        with: { fees: true, payments: true },
        orderBy: [asc(instalments.sequence)],
      },
      refunds: true,
    },
  });
  if (!row) return null;
  return {
    ...row,
    ledger: computeOrder(
      {
        totalAmountCents: row.totalAmountCents,
        instalments: row.instalments,
        refunds: row.refunds,
        cancelled: row.status === "cancelled",
      },
      today,
    ),
  };
}

export type OrderDetail = NonNullable<Awaited<ReturnType<typeof getOrder>>>;

export async function listProviders(db: DbClient, userId: string): Promise<Provider[]> {
  return db.query.providers.findMany({
    where: eq(providers.userId, userId),
    orderBy: [asc(providers.name)],
  });
}

export interface DuePeriod {
  period: number;
  periodUnit: "days";
  total: number;
}

export interface Summary {
  currency: string;
  total: number;
  owedWithoutPending: number;
  pending: number;
  duePeriods: DuePeriod[];
  overdue: boolean;
  overdueTotal: number;
  activeOrders: number;
  totalOrders: number;
  byProviderKind: { kind: Provider["kind"]; total: number; activeOrders: number }[];
  nextDue: (LedgerInstalment<InstalmentWithFees> & { order: OrderWithLedger })[];
}

// The status cache is only used to pick which orders to load; every figure
// is then recomputed from the instalments.
export async function loadActiveOrders(
  db: DbClient,
  userId: string,
  today: string = todayIso(),
): Promise<OrderWithLedger[]> {
  const active = await db.query.orders.findMany({
    where: and(eq(orders.userId, userId), eq(orders.status, "active")),
    with: { provider: true, instalments: { with: { fees: true } }, refunds: true },
  });
  return active.map((row) => withLedger(row, today));
}

export interface ProviderStats {
  provider: Provider;
  activeOrders: number;
  owedAmount: number;
}

export async function providerStats(
  db: DbClient,
  userId: string,
  today: string = todayIso(),
): Promise<ProviderStats[]> {
  const [all, active] = await Promise.all([
    listProviders(db, userId),
    loadActiveOrders(db, userId, today),
  ]);
  return all.map((provider) => {
    const mine = active.filter((o) => o.providerId === provider.id);
    return {
      provider,
      activeOrders: mine.length,
      owedAmount: mine.reduce((sum, o) => sum + o.ledger.owedAmount, 0),
    };
  });
}

export async function summarize(
  db: DbClient,
  userId: string,
  currency: string,
  today: string = todayIso(),
): Promise<Summary> {
  const [ledgers, [totals]] = await Promise.all([
    loadActiveOrders(db, userId, today),
    db.select({ value: count() }).from(orders).where(eq(orders.userId, userId)),
  ]);
  const allInstalments = ledgers.flatMap((o) => o.ledger.instalments);

  const byKind = new Map<Provider["kind"], { total: number; activeOrders: number }>();
  for (const o of ledgers) {
    const entry = byKind.get(o.provider.kind) ?? { total: 0, activeOrders: 0 };
    entry.total += o.ledger.owedAmount;
    entry.activeOrders += 1;
    byKind.set(o.provider.kind, entry);
  }

  const nextDue = ledgers
    .flatMap((order) =>
      order.ledger.instalments
        .filter((i) => i.state !== "paid")
        .map((i) => ({ ...i, order })),
    )
    .sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0));

  const overdue = overdueTotal(allInstalments);
  return {
    currency,
    total: ledgers.reduce((sum, o) => sum + o.ledger.owedAmount, 0),
    owedWithoutPending: ledgers.reduce((sum, o) => sum + o.ledger.owedWithoutPending, 0),
    pending: ledgers.reduce((sum, o) => sum + o.ledger.pendingAmount, 0),
    duePeriods: [15, 30, 60].map((period) => ({
      period,
      periodUnit: "days",
      total: dueWithin(allInstalments, today, period),
    })),
    overdue: overdue > 0,
    overdueTotal: overdue,
    activeOrders: ledgers.length,
    totalOrders: totals?.value ?? 0,
    byProviderKind: [...byKind.entries()].map(([kind, v]) => ({ kind, ...v })),
    nextDue,
  };
}
