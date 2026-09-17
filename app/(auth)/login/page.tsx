import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { currentUser, needsSetup } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const db = getDb();
  if (await currentUser(db)) redirect("/");
  if (await needsSetup(db)) redirect("/setup");
  const { next } = await searchParams;

  return (
    <>
      <h1 className="mb-1 text-heading">Sign in</h1>
      <p className="mb-5 text-caption text-ink-muted">This is a private tracker. Only you can see it.</p>
      <LoginForm next={next ?? "/"} />
    </>
  );
}
