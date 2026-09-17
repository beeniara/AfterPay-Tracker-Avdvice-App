"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, inputClass } from "@/components/ui/field";
import { formToObject, sendJson } from "@/lib/client/api";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function done() {
    router.push(next.startsWith("/") ? next : "/");
    router.refresh();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await sendJson("POST", "/api/auth/login", formToObject(event.currentTarget));
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    done();
  }

  async function usePasskey() {
    setBusy(true);
    setError(null);
    try {
      const optionsJSON = await fetch("/api/auth/passkey/login/options", { method: "POST" }).then((r) => r.json());
      const response = await startAuthentication({ optionsJSON });
      const result = await sendJson("POST", "/api/auth/passkey/login/verify", response);
      if (!result.ok) throw new Error(result.error);
      done();
    } catch (cause) {
      const name = cause instanceof Error ? cause.name : "";
      setError(
        name === "NotAllowedError"
          ? "Passkey sign-in was cancelled"
          : cause instanceof Error
            ? cause.message
            : "Passkey sign-in failed",
      );
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <input name="email" type="email" autoComplete="username" required className={inputClass} />
        </Field>
        <Field label="Password">
          <input name="password" type="password" autoComplete="current-password" required className={inputClass} />
        </Field>
        <FormError message={error} />
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <div className="flex items-center gap-3 text-caption text-ink-subtle">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
      <Button type="button" variant="ghost" onClick={usePasskey} disabled={busy} className="w-full">
        Sign in with a passkey
      </Button>
    </div>
  );
}
