import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteOrderButton } from "@/components/actions/delete-order-button";
import { RecordRefundDialog } from "@/components/actions/record-refund-dialog";
import { Timeline } from "@/components/orders/timeline";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { NoData } from "@/components/ui/no-data";
import { PageTitle } from "@/components/ui/page-title";
import { Progress } from "@/components/ui/progress";
import { getPageContext } from "@/lib/db/context";
import { getOrder } from "@/lib/db/queries";
import { formatCents, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Order" };
export const dynamic = "force-dynamic";

const CHANNEL_LABEL = { online: "Online", in_store: "In-store" } as const;
const KIND_LABEL = {
  bnpl: "Buy now, pay later",
  store_finance: "Store finance",
  loan: "Loan",
  other: "Other",
} as const;

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getPageContext();
  if (!ctx) return <NoData />;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const order = await getOrder(ctx.db, ctx.user.id, id, ctx.today);
  if (!order) notFound();

  const { ledger, currency } = order;
  const money = (cents: number) => formatCents(cents, currency);

  return (
    <>
      <PageTitle>
        <Link href="/orders" className="text-ink-muted hover:text-ink">Orders</Link>
        <span className="mx-2 text-ink-subtle">›</span>
        {CHANNEL_LABEL[order.channel]}{order.reference ? ` #${order.reference}` : ""}
      </PageTitle>

      <section className="flex items-center gap-4 rounded-card bg-primary px-7 py-6">
        <Chip name={order.merchant} size="lg" />
        <div className="min-w-0">
          <h2 className="truncate text-[19px] font-semibold">{order.merchant}</h2>
          <p className="text-body font-semibold text-ink-secondary">{money(order.totalAmountCents)}</p>
        </div>
        <div className="ml-auto"><StatusBadge status={ledger.status} /></div>
      </section>

      <div className="mt-3 flex flex-wrap items-center gap-2 px-1">
        <ButtonLink href={`/orders/${order.id}/edit`} variant="ghost">Edit</ButtonLink>
        <RecordRefundDialog orderId={order.id} currency={currency} today={ctx.today} />
        <span className="ml-auto"><DeleteOrderButton orderId={order.id} merchant={order.merchant} /></span>
      </div>

      <Card>
        <div className="grid gap-12 md:grid-cols-2">
          <div>
            <Badge tone="neutral">{order.instalmentCount} payments</Badge>
            <h2 className="mt-3 mb-1 text-heading">Order summary</h2>
            <dl>
              <KeyValue label="Purchase date" value={formatDate(order.purchasedAt, "long")} />
              <KeyValue label="Order amount" value={money(order.totalAmountCents)} />
              <KeyValue label="Total paid" value={money(ledger.totalPaid)} />
              {ledger.totalFees > 0 ? (
                <KeyValue label="Fees added" value={`+${money(ledger.totalFees)}`} />
              ) : null}
              {ledger.amountRefunded > 0 ? (
                <KeyValue label="Refunded" value={`−${money(ledger.amountRefunded)}`} />
              ) : null}
              <KeyValue label="Total owing" value={money(ledger.owedAmount)} />
              {ledger.pendingAmount > 0 ? (
                <KeyValue label="Pending" value={money(ledger.pendingAmount)} />
              ) : null}
              <KeyValue
                label="True cost"
                value={money(ledger.trueCost)}
                sub={
                  ledger.trueCost !== order.totalAmountCents
                    ? `${ledger.trueCost > order.totalAmountCents ? "+" : "−"}${money(Math.abs(ledger.trueCost - order.totalAmountCents))} vs order amount`
                    : "No fees or refunds"
                }
                emphasis
              />
            </dl>

            <h2 className="mt-7 mb-1 text-heading">Provider</h2>
            <dl>
              <KeyValue label="Name" value={order.provider.name} />
              <KeyValue label="Type" value={KIND_LABEL[order.provider.kind]} />
              {order.provider.website ? <KeyValue label="Website" value={order.provider.website} /> : null}
              {order.provider.supportPhone ? <KeyValue label="Support" value={order.provider.supportPhone} /> : null}
            </dl>

            {order.notes ? (
              <>
                <h2 className="mt-7 mb-2 text-heading">Notes</h2>
                <p className="whitespace-pre-line text-body text-ink-secondary">{order.notes}</p>
              </>
            ) : null}
          </div>

          <div>
            <Progress
              value={ledger.totalPaid}
              max={ledger.totalPaid + ledger.owedAmount}
              label="Share of this order paid"
            />
            <div className="mt-4 flex justify-between">
              <div>
                <div className="text-caption text-ink-muted">Paid</div>
                <div className="text-[24px] font-bold tabular-nums">{money(ledger.totalPaid)}</div>
              </div>
              <div className="text-right">
                <div className="text-caption text-ink-muted">{ledger.remainingCount} remaining</div>
                <div className="text-[24px] font-bold tabular-nums">{money(ledger.owedAmount)}</div>
              </div>
            </div>
            <h2 className="mt-7 mb-4 text-heading">Payment schedule</h2>
            <Timeline order={order} today={ctx.today} />
          </div>
        </div>
      </Card>
    </>
  );
}

function KeyValue({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: string;
  sub?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-3.5 text-body last:border-b-0">
      <dt className="font-semibold">{label}</dt>
      <dd className={`text-right tabular-nums ${emphasis ? "font-bold" : ""}`}>
        {value}
        {sub ? <span className="block text-caption font-normal text-ink-muted">{sub}</span> : null}
      </dd>
    </div>
  );
}
