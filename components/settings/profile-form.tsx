"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, inputClass } from "@/components/ui/field";
import { formToObject, sendJson } from "@/lib/client/api";

export function ProfileForm({
  initial,
  timeZones,
}: {
  initial: { name: string; email: string; currency: string; timeZone: string };
  timeZones: string[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const result = await sendJson("PATCH", "/api/me", formToObject(event.currentTarget));
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
      <Field label="Name">
        <input name="name" defaultValue={initial.name} maxLength={120} className={inputClass} />
      </Field>
      <Field label="Email">
        <input name="email" type="email" defaultValue={initial.email} required className={inputClass} />
      </Field>
      <Field label="Currency" hint="Used for new orders and totals">
        <input name="currency" defaultValue={initial.currency} maxLength={3} pattern="[A-Za-z]{3}" required className={`${inputClass} uppercase`} />
      </Field>
      <Field label="Time zone" hint="Decides what 'today' means for due dates">
        <select name="timeZone" defaultValue={initial.timeZone} className={inputClass}>
          {timeZones.map((tz) => (
            <option key={tz} value={tz}>{tz}</option>
          ))}
        </select>
      </Field>
      <div className="md:col-span-2 flex items-center gap-3">
        <Button type="submit" variant="ghost" disabled={busy}>{busy ? "Saving…" : "Save profile"}</Button>
        {saved ? <span className="text-caption text-success">Saved.</span> : null}
      </div>
      <div className="md:col-span-2"><FormError message={error} /></div>
    </form>
  );
}
