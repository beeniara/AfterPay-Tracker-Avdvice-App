import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { PasskeyManager } from "@/components/auth/passkey-manager";
import { CsvImport } from "@/components/settings/csv-import";
import { ProfileForm } from "@/components/settings/profile-form";
import { UpcomingImport } from "@/components/settings/upcoming-import";
import { ThemeControls } from "@/components/theme/theme-controls";
import { buttonClasses } from "@/components/ui/button";
import { Card, HeroCard } from "@/components/ui/card";
import { PageTitle } from "@/components/ui/page-title";
import { requirePageContext } from "@/lib/db/context";
import { listProviders } from "@/lib/db/queries";
import { passkeys } from "@/lib/db/schema";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { db, user } = await requirePageContext();
  const [providers, keys] = await Promise.all([
    listProviders(db, user.id),
    db.query.passkeys.findMany({ where: eq(passkeys.userId, user.id), orderBy: [desc(passkeys.createdAt)] }),
  ]);

  return (
    <>
      <PageTitle>Settings</PageTitle>
      <HeroCard heading={user.name ?? user.email}>
        <p className="text-body text-ink-secondary">
          {user.email} · {user.currency} · {user.timeZone}
        </p>
      </HeroCard>

      <Card>
        <h2 className="mb-1 text-heading">Profile</h2>
        <p className="mb-5 text-caption text-ink-muted">Your sign-in email, display name, currency and time zone.</p>
        <ProfileForm
          initial={{ name: user.name ?? "", email: user.email, currency: user.currency, timeZone: user.timeZone }}
          timeZones={Intl.supportedValuesOf("timeZone")}
        />
      </Card>

      <Card>
        <h2 className="mb-1 text-heading">Security</h2>
        <p className="mb-5 text-caption text-ink-muted">Sessions live in the database and last 30 days. Changing your password signs out other devices.</p>
        <ChangePasswordForm hasPassword={user.passwordHash !== null} />
        <h3 className="mt-7 mb-3 text-body font-semibold">Passkeys</h3>
        <PasskeyManager
          passkeys={keys.map((k) => ({
            id: k.id,
            name: k.name,
            createdAt: k.createdAt.toISOString(),
            lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
          }))}
        />
      </Card>

      <Card>
        <h2 className="mb-1 text-heading">Appearance</h2>
        <p className="mb-5 text-caption text-ink-muted">Pick an accent and a mode. Saved in this browser and applied instantly.</p>
        <ThemeControls />
      </Card>

      <Card>
        <h2 className="mb-1 text-heading">Import order history</h2>
        <p className="mb-5 text-caption text-ink-muted">
          Upload a CSV with one row per order, match its columns, preview, then import. New orders are added; orders already
          present (by order number) are brought up to the export&apos;s amount owing. Nothing is deleted unless you tick
          &ldquo;replace&rdquo;.
        </p>
        <CsvImport providers={providers} />
      </Card>

      <Card>
        <h2 className="mb-1 text-heading">Update from upcoming payments</h2>
        <p className="mb-5 text-caption text-ink-muted">
          Upload the provider&apos;s upcoming-payments export (one row per instalment still to pay). Active orders get
          their due dates and paid instalments corrected, orders the export no longer lists are marked paid off, and
          new ones are added. Nothing is deleted.
        </p>
        <UpcomingImport providers={providers} />
      </Card>

      <Card>
        <h2 className="mb-1 text-heading">Export everything</h2>
        <p className="mb-4 text-caption text-ink-muted">A JSON file with every provider, order, instalment, fee, payment and refund. Amounts are integer minor units.</p>
        <a href="/api/export" download className={buttonClasses("ghost")}>Download JSON</a>
      </Card>
    </>
  );
}
