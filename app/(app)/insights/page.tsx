import type { Metadata } from "next";
import Link from "next/link";
import { AdviceList } from "@/components/insights/advice-list";
import { AskBox } from "@/components/insights/ask-box";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, HeroCard, HeroFigure } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle } from "@/components/ui/page-title";
import { requirePageContext } from "@/lib/db/context";
import { loadAllOrders } from "@/lib/db/queries";
import { formatCents, formatDate } from "@/lib/format";
import { buildInsights } from "@/lib/insights";

export const metadata: Metadata = { title: "Insights" };
export const dynamic = "force-dynamic";

const KIND_LABEL = {
  bnpl: "Buy now, pay later",
  store_finance: "Store finance",
  loan: "Loan",
  other: "Other",
} as const;

function formatMonth(yearMonth: string, style: "long" | "short" = "long"): string {
  return new Intl.DateTimeFormat("en-NZ", {
    month: style,
    year: style === "long" ? "numeric" : "2-digit",
    timeZone: "UTC",
  }).format(new Date(`${yearMonth}-01T00:00:00Z`));
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-3 last:border-b-0">
      <dt className="text-body text-ink-secondary">
        {label}
        {hint ? <span className="block text-caption text-ink-muted">{hint}</span> : null}
      </dt>
      <dd className="text-body font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export default async function InsightsPage() {
  const { db, user, today } = await requirePageContext();
  const orders = await loadAllOrders(db, user.id, today);
  const money = (cents: number) => formatCents(cents, user.currency);
  const insights = buildInsights(orders, today, {
    money,
    date: (iso) => formatDate(iso, "dayMonth"),
  });
  const percent = `${(insights.feeRate * 100).toFixed(1)}%`;

  if (insights.totalOrders === 0) {
    return (
      <>
        <PageTitle>Insights</PageTitle>
        <Card className="mt-0">
          <EmptyState
            glyph="?"
            title="Nothing to look at yet"
            description="Add an order or import a CSV and this page will tell you what your plans are costing and where you could save."
            action={<ButtonLink href="/orders/new">Add an order</ButtonLink>}
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageTitle>Insights</PageTitle>
      <HeroCard heading="Where you stand">
        <HeroFigure label="Total you owe" value={money(insights.owed)} />
        <HeroFigure label="Fees paid, all time" value={money(insights.fees.total)} />
        <HeroFigure
          label={insights.clearBy ? "Clear if you pay on time" : "Nothing outstanding"}
          value={insights.clearBy ? formatDate(insights.clearBy, "short") : "Clear"}
        />
      </HeroCard>

      <Card>
        <h2 className="mb-4 text-heading">What to consider</h2>
        <AdviceList advice={insights.advice} />
      </Card>

      <Card>
        <h2 className="mb-1 text-heading">Ask about your orders</h2>
        <p className="mb-4 text-caption text-ink-muted">Plain questions, answered from your own data by the model running on your PC.</p>
        <AskBox currency={user.currency} />
      </Card>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card className="mt-0">
          <h2 className="mb-1 text-heading">The next three months</h2>
          <p className="mb-2 text-caption text-ink-muted">What falls due each month, with anything overdue counted in the first.</p>
          <dl>
            {insights.months.map((m) => (
              <Row
                key={m.month}
                label={formatMonth(m.month)}
                hint={m.count === 0 ? "Nothing due" : `${m.count} ${m.count === 1 ? "payment" : "payments"}`}
                value={money(m.total)}
              />
            ))}
          </dl>
        </Card>

        <Card className="mt-0">
          <h2 className="mb-1 text-heading">Your plans at a glance</h2>
          <p className="mb-2 text-caption text-ink-muted">Everything you have recorded, paid off or not.</p>
          <dl>
            <Row label="Orders" value={`${insights.activeOrders} active · ${insights.settledOrders} paid off`} />
            <Row label="Bought" hint="after refunds" value={money(insights.purchased)} />
            <Row label="Paid so far" value={money(insights.paid)} />
            <Row label="Late fees" value={money(insights.fees.late)} />
            {insights.fees.establishment > 0 ? (
              <Row label="Establishment fees" value={money(insights.fees.establishment)} />
            ) : null}
            {insights.fees.other > 0 ? <Row label="Other fees" value={money(insights.fees.other)} /> : null}
            {insights.fees.waived > 0 ? <Row label="Fees waived" value={money(insights.fees.waived)} /> : null}
            <Row label="Fees as a share of what you bought" value={percent} />
            {insights.pending > 0 ? <Row label="Pending" hint="taken, not yet cleared" value={money(insights.pending)} /> : null}
            <Row label="Average order" value={money(insights.averageOrder)} />
            {insights.refunded > 0 ? (
              <Row label="Refunded" hint={`across ${plural(insights.refundedOrders, "order")}`} value={money(insights.refunded)} />
            ) : null}
            <Row
              label="Online · in store"
              hint={`${plural(insights.channels.online.count, "order")} · ${plural(insights.channels.inStore.count, "order")}`}
              value={`${money(insights.channels.online.total)} · ${money(insights.channels.inStore.total)}`}
            />
          </dl>
        </Card>
      </div>

      <Card>
        <h2 className="mb-1 text-heading">Your habits</h2>
        <p className="mb-2 text-caption text-ink-muted">How often, how much, and when you reach for an instalment plan.</p>
        <dl className="md:columns-2 md:gap-10">
          <Row label="New orders a week" hint="last 90 days" value={String(insights.habits.ordersPerWeek)} />
          <Row label="Going onto plans each week" hint="last 90 days" value={money(insights.habits.spendPerWeek)} />
          <Row label="At this pace, over a year" value={money(insights.habits.projectedYear)} />
          <Row label="Orders placed Friday to Sunday" hint="last 12 months" value={`${Math.round(insights.habits.weekendShare * 100)}%`} />
          <Row label="Days with more than one order" hint="last 12 months" value={String(insights.habits.multiOrderDays)} />
          <Row
            label="Busiest day"
            hint={insights.habits.busiestDay ? `${plural(insights.habits.busiestDay.count, "order")} · ${money(insights.habits.busiestDay.total)}` : undefined}
            value={insights.habits.busiestDay ? formatDate(insights.habits.busiestDay.date, "short") : "—"}
          />
          <Row label="Weeks in a row with an order" value={String(insights.habits.weeklyStreak)} />
          <Row
            label="Since your last order"
            value={insights.habits.daysSinceLastOrder === null ? "—" : plural(insights.habits.daysSinceLastOrder, "day")}
          />
          <Row
            label="Last 12 months"
            hint={plural(insights.habits.lastYear.count, "order")}
            value={money(insights.habits.lastYear.total)}
          />
          <Row
            label="The 12 months before"
            hint={plural(insights.habits.priorYear.count, "order")}
            value={money(insights.habits.priorYear.total)}
          />
        </dl>
      </Card>

      <Card>
        <h2 className="mb-1 text-heading">Your biggest orders</h2>
        <p className="mb-4 text-caption text-ink-muted">True cost is what the order came to once fees were added and refunds taken off.</p>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Merchant</th>
                <th scope="col">Status</th>
                <th scope="col">Bought</th>
                <th scope="col" className="text-right">Order</th>
                <th scope="col" className="text-right">True cost</th>
                <th scope="col" className="text-right">Owing</th>
              </tr>
            </thead>
            <tbody>
              {insights.biggestOrders.map((o) => (
                <tr key={o.id} className="relative hover:bg-surface-sunken/60">
                  <td>
                    <span className="flex items-center gap-3.5">
                      <Chip name={o.merchant} />
                      <span className="min-w-0">
                        <Link href={`/orders/${o.id}`} className="row-link block truncate font-semibold">
                          {o.merchant}
                        </Link>
                        <span className="block text-caption text-ink-muted">{o.providerName}</span>
                      </span>
                    </span>
                  </td>
                  <td data-label="Status"><StatusBadge status={o.status} /></td>
                  <td data-label="Bought" className="whitespace-nowrap text-ink-secondary">{formatDate(o.purchasedOn, "short")}</td>
                  <td data-label="Order" className="text-right tabular-nums">{money(o.total)}</td>
                  <td data-label="True cost" className={`text-right tabular-nums ${o.trueCost > o.total ? "font-semibold text-danger" : ""}`}>{money(o.trueCost)}</td>
                  <td data-label="Owing" className="text-right font-semibold tabular-nums">{money(o.owed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 text-heading">Where you shop most</h2>
        <p className="mb-4 text-caption text-ink-muted">Tap a shop to see just its orders.</p>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Merchant</th>
                <th scope="col">Orders</th>
                <th scope="col">Last bought</th>
                <th scope="col" className="text-right">Spent</th>
                <th scope="col" className="text-right">Late fees</th>
              </tr>
            </thead>
            <tbody>
              {insights.merchants.map((m) => (
                <tr key={m.name} className="relative hover:bg-surface-sunken/60">
                  <td>
                    <span className="flex items-center gap-3.5">
                      <Chip name={m.name} />
                      <Link href={`/orders?merchant=${encodeURIComponent(m.name)}`} className="row-link block truncate font-semibold">
                        {m.name}
                      </Link>
                    </span>
                  </td>
                  <td data-label="Orders" className="whitespace-nowrap">
                    {m.orders}
                    {m.activeOrders > 0 ? <span className="text-caption text-ink-muted"> · {m.activeOrders} active</span> : null}
                  </td>
                  <td data-label="Last bought" className="whitespace-nowrap text-ink-secondary">{formatDate(m.lastPurchasedOn, "short")}</td>
                  <td data-label="Spent" className="text-right font-semibold tabular-nums">{money(m.spent)}</td>
                  <td data-label="Late fees" className="text-right tabular-nums">{money(m.lateFees)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 text-heading">The last twelve months</h2>
        <p className="mb-4 text-caption text-ink-muted">What you put on instalments each month.</p>
        <ol className="grid gap-2">
          {insights.history.map((m) => {
            const max = Math.max(...insights.history.map((h) => h.total), 1);
            return (
              <li key={m.month} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 text-body">
                <span className="text-ink-secondary">{formatMonth(m.month, "short")}</span>
                <span className="h-[7px] overflow-hidden rounded-pill bg-surface-chip" aria-hidden="true">
                  <span className="block h-full rounded-pill bg-prominent" style={{ width: `${Math.round((m.total / max) * 100)}%` }} />
                </span>
                <span className="whitespace-nowrap text-right tabular-nums">
                  <span className="font-semibold">{money(m.total)}</span>
                  <span className="text-caption text-ink-muted"> · {plural(m.count, "order")}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </Card>

      <Card>
        <h2 className="mb-4 text-heading">By provider</h2>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Provider</th>
                <th scope="col">Active</th>
                <th scope="col" className="text-right">Owing</th>
                <th scope="col" className="text-right">Late fees</th>
                <th scope="col" className="text-right">All fees</th>
              </tr>
            </thead>
            <tbody>
              {insights.providers.map((p) => (
                <tr key={p.id} className="relative hover:bg-surface-sunken/60">
                  <td>
                    <span className="flex items-center gap-3.5">
                      <Chip name={p.name} />
                      <span className="min-w-0">
                        <Link href={`/orders?providerId=${p.id}`} className="row-link block truncate font-semibold">
                          {p.name}
                        </Link>
                        <span className="block text-caption text-ink-muted">{KIND_LABEL[p.kind]}</span>
                      </span>
                    </span>
                  </td>
                  <td data-label="Active orders">{p.activeOrders}</td>
                  <td data-label="Owing" className="text-right font-semibold tabular-nums">{money(p.owed)}</td>
                  <td data-label="Late fees" className="text-right tabular-nums">{money(p.lateFees)}</td>
                  <td data-label="All fees" className="text-right tabular-nums">{money(p.fees)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
