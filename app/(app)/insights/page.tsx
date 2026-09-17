import type { Metadata } from "next";
import Link from "next/link";
import { AdviceList } from "@/components/insights/advice-list";
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

function formatMonth(yearMonth: string): string {
  return new Intl.DateTimeFormat("en-NZ", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${yearMonth}-01T00:00:00Z`),
  );
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
          </dl>
        </Card>
      </div>

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
