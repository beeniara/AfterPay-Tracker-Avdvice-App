"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button type="button" onClick={signOut} disabled={busy} className={cn("text-caption font-medium text-ink-muted hover:text-ink", className)}>
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
