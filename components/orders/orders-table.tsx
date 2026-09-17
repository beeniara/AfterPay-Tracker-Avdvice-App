import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";
import { StatusBadge } from "@/components/ui/badge";
import { Chip } from "@/components/ui/chip";
import type { OrderWithLedger } from "@/lib/db/queries";
import { formatCents, formatDate } from "@/lib/format";

const CHANNEL_LABEL = { online: "Online", in_store: "In-store" } as const;

export function OrdersTable({ orders }: { orders: OrderWithLedger[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Merchant</th>
            <th scope="col">Status</th>
            <th scope="col">Purchase date</th>
            <th scope="col">Order no.</th>
            <th scope="col" className="text-right">Order amount</th>
            <th scope="col" className="text-right">Amount owing</th>
            <th scope="col"><span className="sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className="relative hover:bg-surface-sunken/60">
              <td>
                <span className="flex items-center gap-3.5">
                  <Chip name={order.merchant} />
                  <span className="min-w-0">
                    <Link href={`/orders/${order.id}`} className="row-link block truncate font-semibold text-ink">
                      {order.merchant}
                    </Link>
                    <span className="block text-caption text-ink-muted">{order.provider.name}</span>
                  </span>
                </span>
              </td>
              <td data-label="Status"><StatusBadge status={order.ledger.status} /></td>
              <td data-label="Purchased" className="whitespace-nowrap">{formatDate(order.purchasedAt)}</td>
              <td data-label="Order no." className="whitespace-nowrap text-ink-secondary">
                {CHANNEL_LABEL[order.channel]}{order.reference ? ` #${order.reference}` : ""}
              </td>
              <td data-label="Order amount" className="text-right tabular-nums">{formatCents(order.totalAmountCents, order.currency)}</td>
              <td data-label="Owing" className="text-right font-semibold tabular-nums">
                {formatCents(order.ledger.owedAmount, order.currency)}
              </td>
              <td className="text-right max-rail:hidden">
                <ChevronRightIcon className="inline size-3.5 text-ink-subtle" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
