import type { Metadata } from "next";
import { ThemeControls } from "@/components/theme/theme-controls";
import { Card, HeroCard } from "@/components/ui/card";
import { PageTitle } from "@/components/ui/page-title";
import { getPageContext } from "@/lib/db/context";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await getPageContext();

  return (
    <>
      <PageTitle>Settings</PageTitle>
      <HeroCard heading={ctx?.user.name ?? ctx?.user.email ?? "Settings"}>
        <p className="text-body text-ink-secondary">
          {ctx
            ? `Currency ${ctx.user.currency} · ${ctx.user.timeZone}`
            : "No account yet — import a CSV to create one."}
        </p>
      </HeroCard>

      <Card>
        <h2 className="mb-1 text-heading">Appearance</h2>
        <p className="mb-5 text-caption text-ink-muted">
          Pick an accent and a mode. Saved in this browser and applied instantly.
        </p>
        <ThemeControls />
      </Card>

      <Card>
        <h2 className="mb-1 text-heading">Import order history</h2>
        <p className="text-body text-ink-secondary">
          Drop a CSV in <code className="rounded bg-surface-chip px-1.5 py-0.5 text-caption">data/</code> and run{" "}
          <code className="rounded bg-surface-chip px-1.5 py-0.5 text-caption">pnpm import:csv --file data/orders.csv --provider &quot;Name&quot;</code>.
          In-app upload with column mapping is coming in a later milestone.
        </p>
      </Card>
    </>
  );
}
