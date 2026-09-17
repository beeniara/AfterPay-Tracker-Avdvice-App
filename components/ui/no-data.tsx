import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export function NoData() {
  return (
    <Card className="mt-0">
      <EmptyState
        glyph="0"
        title="No data yet"
        description="Import your order history or add your first order and this page fills in."
        action={<ButtonLink href="/settings">Go to settings</ButtonLink>}
      />
    </Card>
  );
}
