import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrderForm } from "@/components/orders/order-form";
import { Card } from "@/components/ui/card";
import { PageTitle } from "@/components/ui/page-title";
import { toIsoDate } from "@/lib/dates";
import { requirePageContext } from "@/lib/db/context";
import { getOrder, listProviders } from "@/lib/db/queries";

export const metadata: Metadata = { title: "Edit order" };
export const dynamic = "force-dynamic";

export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, user, today } = await requirePageContext();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [order, providers] = await Promise.all([getOrder(db, user.id, id, today), listProviders(db, user.id)]);
  if (!order) notFound();

  return (
    <>
      <PageTitle>Edit {order.merchant}</PageTitle>
      <Card className="mt-0">
        <OrderForm
          providers={providers}
          currency={user.currency}
          today={today}
          initial={{
            id: order.id,
            providerId: order.providerId,
            merchant: order.merchant,
            reference: order.reference,
            channel: order.channel,
            purchasedOn: toIsoDate(order.purchasedAt, "UTC"),
            notes: order.notes,
          }}
        />
      </Card>
    </>
  );
}
