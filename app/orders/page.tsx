import type { Metadata } from "next";
import { BreakdownDialog } from "@/components/orders/breakdown-dialog";
import { FilterBar } from "@/components/orders/filter-bar";
import { OrdersTable } from "@/components/orders/orders-table";
import { ButtonLink } from "@/components/ui/button";
import { Card, HeroCard, HeroFigure } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { NoData } from "@/components/ui/no-data";
import { PageTitle } from "@/components/ui/page-title";
import { Pagination } from "@/components/ui/pagination";
import {
  orderListQuerySchema,
  parseSearchParams,
  type OrderListQuery,
} from "@/lib/api/params";
import { getPageContext } from "@/lib/db/context";
import { listOrders, listProviders, summarize } from "@/lib/db/queries";
import { formatCents } from "@/lib/format";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

const DEFAULT_QUERY: OrderListQuery = {
  offset: 0,
  limit: 25,
  orderBy: "purchasedAt",
  ascending: false,
};

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = await searchParams;
  const parsed = parseSearchParams(orderListQuerySchema, raw);
  const query = parsed.ok ? parsed.value : DEFAULT_QUERY;

  const ctx = await getPageContext();
  if (!ctx) {
    return (
      <>
        <PageTitle>Orders</PageTitle>
        <NoData />
      </>
    );
  }
  const { db, user, today } = ctx;
  const [summary, providers, page] = await Promise.all([
    summarize(db, user.id, user.currency, today),
    listProviders(db, user.id),
    listOrders(db, user.id, query, today),
  ]);

  const { q, merchant, providerId, status, from, to } = query;
  const filters = { q, merchant, providerId, status, from, to };
  const hasFilters = Object.values(filters).some((v) => v !== undefined);
  const hrefFor = (offset: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(raw)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (first) params.set(key, first);
    }
    params.set("offset", String(offset));
    return `/orders?${params.toString()}`;
  };

  return (
    <>
      <PageTitle>Orders</PageTitle>
      <HeroCard heading="Total owing" className="flex items-center justify-between">
        <HeroFigure
          label={`${summary.activeOrders} active of ${summary.totalOrders} orders`}
          value={formatCents(summary.total, user.currency)}
        />
        <div className="flex gap-2">
          <ButtonLink href="/orders/new" variant="ghost">Add order</ButtonLink>
          <BreakdownDialog periods={summary.duePeriods} currency={user.currency} />
        </div>
      </HeroCard>
      <Card>
        <FilterBar filters={filters} providers={providers} hasFilters={hasFilters} />
        {!parsed.ok ? (
          <p role="alert" className="mb-4 rounded-chip bg-danger-tint px-4 py-2 text-caption text-danger">
            Some filters were ignored: {parsed.error}
          </p>
        ) : null}
        {page.results.length === 0 ? (
          <EmptyState
            glyph="?"
            title={hasFilters ? "No orders match" : "No orders yet"}
            description={
              hasFilters
                ? "Try a different search or clear the filters."
                : "Add an order or import a CSV to get started."
            }
            action={
              hasFilters ? (
                <ButtonLink href="/orders" variant="ghost">Clear filters</ButtonLink>
              ) : (
                <ButtonLink href="/settings">Import a CSV</ButtonLink>
              )
            }
          />
        ) : (
          <>
            <p className="mb-3 text-caption text-ink-muted">
              {page.totalResults.toLocaleString("en-NZ")} orders
            </p>
            <OrdersTable orders={page.results} />
            <Pagination
              totalResults={page.totalResults}
              offset={query.offset}
              limit={query.limit}
              hrefFor={hrefFor}
            />
          </>
        )}
      </Card>
    </>
  );
}
