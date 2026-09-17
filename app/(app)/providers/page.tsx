import type { Metadata } from "next";
import Link from "next/link";
import { DeleteProviderButton, ProviderDialog } from "@/components/providers/provider-dialog";
import { Card, HeroCard, HeroFigure } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle } from "@/components/ui/page-title";
import { requirePageContext } from "@/lib/db/context";
import { providerStats } from "@/lib/db/queries";
import { formatCents } from "@/lib/format";

export const metadata: Metadata = { title: "Providers" };
export const dynamic = "force-dynamic";

const KIND_LABEL = {
  bnpl: "Buy now, pay later",
  store_finance: "Store finance",
  loan: "Loan",
  other: "Other",
} as const;

export default async function ProvidersPage() {
  const { db, user, today } = await requirePageContext();
  const stats = await providerStats(db, user.id, today);
  const money = (cents: number) => formatCents(cents, user.currency);
  const total = stats.reduce((sum, s) => sum + s.owedAmount, 0);

  return (
    <>
      <PageTitle>Providers</PageTitle>
      <HeroCard heading="Who you owe" className="flex flex-wrap items-center justify-between gap-4">
        <HeroFigure label={`${stats.length} ${stats.length === 1 ? "provider" : "providers"}`} value={money(total)} />
        <ProviderDialog />
      </HeroCard>
      <Card>
        {stats.length === 0 ? (
          <EmptyState
            glyph="+"
            title="No providers yet"
            description="A provider is whoever you owe the money to. Add one before adding orders."
            action={<ProviderDialog />}
          />
        ) : (
          <ul className="divide-y divide-line">
            {stats.map(({ provider, activeOrders, owedAmount }) => (
              <li key={provider.id} className="flex flex-wrap items-center gap-3.5 py-[15px]">
                <Chip name={provider.name} hue={provider.colorSeed} />
                <div className="min-w-0 flex-1">
                  <Link href={`/orders?providerId=${provider.id}`} className="font-semibold hover:underline">
                    {provider.name}
                  </Link>
                  <div className="text-caption text-ink-muted">
                    {KIND_LABEL[provider.kind]} · {activeOrders} active {activeOrders === 1 ? "order" : "orders"}
                  </div>
                </div>
                <div className="text-right font-semibold tabular-nums">{money(owedAmount)}</div>
                <div className="flex items-center gap-1 pl-3">
                  <ProviderDialog provider={provider} />
                  {activeOrders === 0 ? <DeleteProviderButton provider={provider} /> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
