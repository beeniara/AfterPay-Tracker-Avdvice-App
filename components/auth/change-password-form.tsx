"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, inputClass } from "@/components/ui/field";
import { formToObject, sendJson } from "@/lib/client/api";

export function ChangePasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formToObject(form);
    if (values.newPassword !== values.confirm) {
      setError("New passwords don't match");
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    const result = await sendJson("POST", "/api/auth/password", {
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    form.reset();
    setSaved(true);
  }

  return (
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-3 md:items-end">
      {hasPassword ? (
        <Field label="Current password">
          <input name="currentPassword" type="password" autoComplete="current-password" required className={inputClass} />
        </Field>
      ) : null}
      <Field label="New password">
        <input name="newPassword" type="password" autoComplete="new-password" required minLength={8} className={inputClass} />
      </Field>
      <Field label="Confirm">
        <input name="confirm" type="password" autoComplete="new-password" required minLength={8} className={inputClass} />
      </Field>
      <div className="md:col-span-3 flex items-center gap-3">
        <Button type="submit" variant="ghost" disabled={busy}>{busy ? "Saving…" : hasPassword ? "Change password" : "Set password"}</Button>
        {saved ? <span className="text-caption text-success">Password updated. Other devices were signed out.</span> : null}
      </div>
      <div className="md:col-span-3"><FormError message={error} /></div>
    </form>
  );
}
