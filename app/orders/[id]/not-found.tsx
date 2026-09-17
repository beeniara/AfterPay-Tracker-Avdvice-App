import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle } from "@/components/ui/page-title";

export default function OrderNotFound() {
  return (
    <>
      <PageTitle>Order</PageTitle>
      <Card className="mt-0">
        <EmptyState
          glyph="?"
          title="That order doesn't exist"
          description="It may have been deleted, or the link is wrong."
          action={<ButtonLink href="/orders">Back to orders</ButtonLink>}
        />
      </Card>
    </>
  );
}
