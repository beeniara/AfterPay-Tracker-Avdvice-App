import Link from "next/link";
import { RecordPaymentDialog } from "@/components/actions/record-payment-dialog";
import { AlertIcon, CalendarIcon } from "@/components/icons";
import { ButtonLink } from "@/components/ui/button";
import { Card, HeroCard, HeroFigure } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle } from "@/components/ui/page-title";
import { requirePageContext } from "@/lib/db/context";
import { summarize } from "@/lib/db/queries";
import { describeDue, formatCents, formatDate, ordinalOf } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { db, user, today } = await requirePageContext();
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
        <CalendarIcon className="size-4 shrink-0 text-ink-muted" />
        <span>
          You have <strong>{money(due30)}</strong> due in the next 30 days.
        </span>
      </div>

      {summary.overdue ? (
        <Card className="bg-danger-tint">
          <div className="flex flex-wrap items-center gap-3">
            <AlertIcon className="size-5 shrink-0 text-danger" />
            <div className="flex-1">
              <h2 className="text-heading text-danger">Overdue</h2>
              <p className="text-body text-ink-secondary">{money(summary.overdueTotal)} is past its due date.</p>
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
            description={
              summary.totalOrders === 0
                ? "Add your first order or import a CSV in Settings."
                : "Every instalment is paid. Add an order when you take on a new one."
            }
            action={<ButtonLink href={summary.totalOrders === 0 ? "/orders/new" : "/orders"}>{summary.totalOrders === 0 ? "Add an order" : "Go to orders"}</ButtonLink>}
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {nextTwo.map((i) => {
              const due = describeDue(i.dueOn, today);
              return (
                <div key={i.id} className="relative flex items-center gap-3.5 rounded-card border border-line p-4 hover:bg-surface-sunken/60">
                  <Chip name={i.order.merchant} />
                  <span className="min-w-0 flex-1">
                    <Link href={`/orders/${i.order.id}`} className="row-link block truncate font-semibold">
                      {i.order.merchant}
                    </Link>
                    <span className="block text-caption text-ink-muted">
                      {ordinalOf(i.sequence, i.order.instalmentCount)} · {due.label} · {formatDate(i.dueOn, "dayMonth")}
                    </span>
                  </span>
                  <RecordPaymentDialog
                    instalmentId={i.id}
                    currency={user.currency}
                    defaultAmountCents={i.amountPayable}
                    today={today}
                    description={`${i.order.merchant} · ${ordinalOf(i.sequence, i.order.instalmentCount)} · due ${formatDate(i.dueOn, "long")}`}
                    triggerLabel={`Pay ${money(i.amountPayable)}`}
                    className="relative z-10"
                  />
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
