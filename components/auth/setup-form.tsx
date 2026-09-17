"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, inputClass } from "@/components/ui/field";
import { formToObject, sendJson } from "@/lib/client/api";

export function SetupForm({ defaultEmail, defaultName }: { defaultEmail: string; defaultName: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formToObject(form);
    if (values.password !== values.confirm) {
      setError("Passwords don't match");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await sendJson("POST", "/api/auth/setup", {
      email: values.email,
      name: values.name,
      password: values.password,
    });
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Your name">
        <input name="name" autoComplete="name" defaultValue={defaultName} className={inputClass} />
      </Field>
      <Field label="Email">
        <input name="email" type="email" autoComplete="username" required defaultValue={defaultEmail} className={inputClass} />
      </Field>
      <Field label="Password" hint="At least 8 characters">
        <input name="password" type="password" autoComplete="new-password" required minLength={8} className={inputClass} />
      </Field>
      <Field label="Confirm password">
        <input name="confirm" type="password" autoComplete="new-password" required minLength={8} className={inputClass} />
      </Field>
      <FormError message={error} />
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Creating…" : "Create account"}
      </Button>
    </form>
  );
}
