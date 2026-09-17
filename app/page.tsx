import Link from "next/link";
import { AlertIcon, CalendarIcon } from "@/components/icons";
import { ButtonLink } from "@/components/ui/button";
import { Card, HeroCard, HeroFigure } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { NoData } from "@/components/ui/no-data";
import { PageTitle } from "@/components/ui/page-title";
import { getPageContext } from "@/lib/db/context";
import { summarize } from "@/lib/db/queries";
import { describeDue, formatCents, formatDate, ordinalOf } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const ctx = await getPageContext();
  if (!ctx) {
    return (
      <>
        <PageTitle>Dashboard</PageTitle>
        <NoData />
      </>
    );
  }
  const { db, user, today } = ctx;
  const summary = await summarize(db, user.id, user.currency, today);
  const money = (cents: number) => formatCents(cents, user.currency);
  const due30 = summary.duePeriods.find((p) => p.period === 30)?.total ?? 0;
  const nextTwo = summary.nextDue.slice(0, 2);
  const firstName = user.name?.split(" ")[0];

  return (
    <>
      <PageTitle>Dashboard</PageTitle>
      <HeroCard heading={firstName ? `Hey ${firstName}` : "What you owe"}>
        <HeroFigure label="Total you owe" value={money(summary.total)} />
        <HeroFigure label="Excluding pending" value={money(summary.owedWithoutPending)} />
      </HeroCard>
      <div className="mt-2 flex items-center gap-2.5 rounded-card bg-surface px-7 py-4 text-body">
        <CalendarIcon className="size-4 text-ink-muted" />
        You have <strong>{money(due30)}</strong> due in the next 30 days.
      </div>

      {summary.overdue ? (
        <Card className="bg-danger-tint">
          <div className="flex items-center gap-3">
            <AlertIcon className="size-5 shrink-0 text-danger" />
            <div className="flex-1">
              <h2 className="text-heading text-danger">Overdue</h2>
              <p className="text-body text-ink-secondary">
                {money(summary.overdueTotal)} is past its due date.
              </p>
            </div>
            <ButtonLink href="/upcoming">See what&apos;s overdue</ButtonLink>
          </div>
        </Card>
      ) : null}

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-heading">Your upcoming payments</h2>
          {summary.nextDue.length > 2 ? <ButtonLink href="/upcoming">See all</ButtonLink> : null}
        </div>
        {nextTwo.length === 0 ? (
          <EmptyState
            glyph="✓"
            title="Nothing due"
            description="Every instalment is paid. Add an order when you take on a new one."
            action={<ButtonLink href="/orders">Go to orders</ButtonLink>}
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {nextTwo.map((i) => {
              const due = describeDue(i.dueOn, today);
              return (
                <Link
                  key={i.id}
                  href={`/orders/${i.order.id}`}
                  className="flex items-center gap-3.5 rounded-card border border-line p-4 hover:bg-surface-sunken/60"
                >
                  <Chip name={i.order.merchant} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{i.order.merchant}</span>
                    <span className="block text-caption text-ink-muted">
                      {ordinalOf(i.sequence, i.order.instalmentCount)} · {due.label} · {formatDate(i.dueOn, "dayMonth")}
                    </span>
                  </span>
                  <span className="rounded-pill bg-primary px-4 py-2 text-[13px] font-semibold tabular-nums">
                    {money(i.amountOwed)}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
