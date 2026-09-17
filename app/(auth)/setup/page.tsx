import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SetupForm } from "@/components/auth/setup-form";
import { needsSetup } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";

export const metadata: Metadata = { title: "Set up" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const db = getDb();
  if (!(await needsSetup(db))) redirect("/login");
  const existing = await db.query.users.findFirst({ orderBy: [asc(users.createdAt)] });
  const imported = existing && existing.email.endsWith("@localhost");

  return (
    <>
      <h1 className="mb-1 text-heading">Create your account</h1>
      <p className="mb-5 text-caption text-ink-muted">
        {imported
          ? "Your imported orders are already here — choose the email and password you'll sign in with."
          : "One account, yours. You can add a passkey afterwards in Settings."}
      </p>
      <SetupForm defaultEmail={imported ? "" : (existing?.email ?? "")} defaultName={existing?.name ?? ""} />
    </>
  );
}
