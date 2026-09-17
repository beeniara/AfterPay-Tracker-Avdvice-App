import { ButtonLink } from "@/components/ui/button";
import { Card, HeroCard, HeroFigure } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle } from "@/components/ui/page-title";

export default function DashboardPage() {
  return (
    <>
      <PageTitle>Dashboard</PageTitle>
      <HeroCard heading="What you owe">
        <HeroFigure label="Total owing" value="$0.00" />
        <HeroFigure label="Excluding pending" value="$0.00" />
      </HeroCard>
      <Card>
        <EmptyState
          glyph="0"
          title="Nothing owing yet"
          description="Add an order or import a CSV and this page will show what is due next."
          action={<ButtonLink href="/orders">Go to orders</ButtonLink>}
        />
      </Card>
    </>
  );
}
