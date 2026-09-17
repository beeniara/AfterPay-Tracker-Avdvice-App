import type { Metadata } from "next";
import Link from "next/link";
import { RecordPaymentDialog } from "@/components/actions/record-payment-dialog";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, HeroCard, HeroFigure } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle } from "@/components/ui/page-title";
import { requirePageContext } from "@/lib/db/context";
import { summarize } from "@/lib/db/queries";
import { describeDue, formatCents, formatDate, ordinalOf } from "@/lib/format";

export const metadata: Metadata = { title: "Upcoming payments" };
export const dynamic = "force-dynamic";

export default async function UpcomingPage() {
  const { db, user, today } = await requirePageContext();
  const summary = await summarize(db, user.id, user.currency, today);
  const money = (cents: number) => formatCents(cents, user.currency);

  return (
    <>
      <PageTitle>Upcoming payments</PageTitle>
      <HeroCard heading="Coming up">
        {summary.duePeriods.map((p) => (
          <HeroFigure key={p.period} label={`Due in ${p.period} days`} value={money(p.total)} />
        ))}
      </HeroCard>
      <Card>
        {summary.nextDue.length === 0 ? (
          <EmptyState glyph="✓" title="Nothing due" description="Every instalment is paid." action={<ButtonLink href="/orders">Go to orders</ButtonLink>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Merchant</th>
                  <th scope="col">Payment</th>
                  <th scope="col">Due</th>
                  <th scope="col">Date</th>
                  <th scope="col" className="text-right">Amount</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {summary.nextDue.map((i) => {
                  const due = describeDue(i.dueOn, today);
                  const overdue = i.state === "overdue";
                  return (
                    <tr key={i.id} data-overdue={overdue} className="relative hover:bg-surface-sunken/60">
                      <td>
                        <span className="flex items-center gap-3.5">
                          <Chip name={i.order.merchant} />
                          <span className="min-w-0">
                            <Link href={`/orders/${i.order.id}`} className="row-link block truncate font-semibold">
                              {i.order.merchant}
                            </Link>
                            <span className="block text-caption text-ink-muted">{i.order.provider.name}</span>
                          </span>
                        </span>
                      </td>
                      <td data-label="Payment" className="whitespace-nowrap">{ordinalOf(i.sequence, i.order.instalmentCount)}</td>
                      <td data-label="Due" className="whitespace-nowrap">
                        {overdue ? (
                          <Badge tone="danger">Overdue · {due.label}</Badge>
                        ) : i.state === "pending" ? (
                          <Badge tone="warning">Pending</Badge>
                        ) : (
                          <span className={due.tone === "warning" ? "font-semibold" : ""}>{due.label}</span>
                        )}
                      </td>
                      <td data-label="Date" className="whitespace-nowrap text-ink-secondary">{formatDate(i.dueOn, "long")}</td>
                      <td data-label="Amount" className="text-right font-semibold tabular-nums">{money(i.amountOwed)}</td>
                      <td className="text-right">
                        <RecordPaymentDialog
                          instalmentId={i.id}
                          currency={user.currency}
                          defaultAmountCents={i.amountPayable}
                          today={today}
                          description={`${i.order.merchant} · ${ordinalOf(i.sequence, i.order.instalmentCount)} · due ${formatDate(i.dueOn, "long")}`}
                          className="relative z-10 max-rail:w-full"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
