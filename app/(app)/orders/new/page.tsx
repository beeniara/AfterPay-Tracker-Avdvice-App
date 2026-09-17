import type { Metadata } from "next";
import { OrderForm } from "@/components/orders/order-form";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle } from "@/components/ui/page-title";
import { requirePageContext } from "@/lib/db/context";
import { listProviders } from "@/lib/db/queries";

export const metadata: Metadata = { title: "Add order" };
export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  const { db, user, today } = await requirePageContext();
  const providers = await listProviders(db, user.id);

  return (
    <>
      <PageTitle>Add an order</PageTitle>
      <Card className="mt-0">
        {providers.length === 0 ? (
          <EmptyState
            glyph="+"
            title="Add a provider first"
            description="Orders belong to whoever you owe the money to."
            action={<ButtonLink href="/providers">Go to providers</ButtonLink>}
          />
        ) : (
          <OrderForm providers={providers} currency={user.currency} today={today} />
        )}
      </Card>
    </>
  );
}
