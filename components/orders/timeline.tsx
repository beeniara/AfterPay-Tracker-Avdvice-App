import { RecordFeeDialog } from "@/components/actions/record-fee-dialog";
import { RecordPaymentDialog } from "@/components/actions/record-payment-dialog";
import { CaretDownIcon, CheckIcon } from "@/components/icons";
import type { OrderDetail } from "@/lib/db/queries";
import { formatCents, formatDate, ordinalOf } from "@/lib/format";
import type { InstalmentState } from "@/lib/ledger";

const STATE_LABEL: Record<InstalmentState, string> = {
  paid: "Paid",
  pending: "Pending",
  overdue: "Overdue",
  upcoming: "Upcoming",
};

const METHOD_LABEL = { card: "Card", bank: "Bank", cash: "Cash", other: "Other" } as const;
const FEE_LABEL = { late: "Late fee", establishment: "Establishment fee", other: "Fee" } as const;

export function Timeline({ order, today }: { order: OrderDetail; today: string }) {
  const { currency, ledger } = order;
  const count = ledger.instalments.length;
  const money = (cents: number) => formatCents(cents, currency);

  return (
    <ol className="timeline" aria-label="Payment schedule">
      {ledger.instalments.map((i) => {
        const isLast = i.sequence === count;
        return (
          <li key={i.id}>
            <span className="timeline-dot" data-state={i.state} aria-hidden="true">
              {i.state === "paid" ? <CheckIcon className="size-3" /> : null}
            </span>
            <details>
              <summary className="flex items-start justify-between gap-4">
                <span className="min-w-0">
                  <span className="block font-semibold">{formatDate(i.dueOn, "dayMonth")}</span>
                  <span className="block text-caption text-ink-muted">
                    {isLast ? "Final payment" : ordinalOf(i.sequence, count)} · {STATE_LABEL[i.state]}
                    {i.feesTotal > 0 ? ` · incl. ${money(i.feesTotal)} fees` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2 font-semibold tabular-nums">
                  {money(i.amountWithFees)}
                  <CaretDownIcon className="caret size-3 text-ink-subtle" />
                </span>
              </summary>
              <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 rounded-chip bg-surface-sunken px-4 py-3 text-caption">
                <dt className="text-ink-muted">Scheduled</dt>
                <dd className="text-right tabular-nums">{money(i.principalCents)}</dd>
                {i.fees.map((fee) => (
                  <Row
                    key={fee.id}
                    label={`${FEE_LABEL[fee.kind]} · ${formatDate(fee.incurredOn)}`}
                    value={`+${money(fee.amountCents)}`}
                  />
                ))}
                {i.payments.map((p) => (
                  <Row
                    key={p.id}
                    label={`Paid by ${METHOD_LABEL[p.method].toLowerCase()} · ${formatDate(p.paidOn)}`}
                    value={`−${money(p.amountCents)}`}
                  />
                ))}
                {i.pendingCents > 0 ? <Row label="Pending" value={money(i.pendingCents)} /> : null}
                {i.waivedCents > 0 ? <Row label="Waived" value={`−${money(i.waivedCents)}`} /> : null}
                <dt className="font-semibold text-ink">Still owing</dt>
                <dd className="text-right font-semibold tabular-nums">{money(i.amountOwed)}</dd>
                <div className="col-span-2 mt-2 flex flex-wrap gap-2">
                  <RecordPaymentDialog
                    instalmentId={i.id}
                    currency={currency}
                    defaultAmountCents={i.amountPayable}
                    today={today}
                    description={`${order.merchant} · ${ordinalOf(i.sequence, count)} · ${money(i.amountPayable)} payable`}
                    triggerLabel={i.state === "paid" ? "Record payment" : "Mark paid"}
                    variant="prominent"
                  />
                  <RecordFeeDialog
                    instalmentId={i.id}
                    currency={currency}
                    today={today}
                    description={`${order.merchant} · ${ordinalOf(i.sequence, count)}`}
                  />
                </div>
              </dl>
            </details>
          </li>
        );
      })}
    </ol>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </>
  );
}
