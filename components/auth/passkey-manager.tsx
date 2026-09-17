"use client";

import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError, inputClass } from "@/components/ui/field";
import { sendJson } from "@/lib/client/api";
import { formatDate } from "@/lib/format";

export interface PasskeySummary {
  id: string;
  name: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export function PasskeyManager({ passkeys }: { passkeys: PasskeySummary[] }) {
  const router = useRouter();
  const [supported, setSupported] = useState(true);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setSupported(browserSupportsWebAuthn()), []);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const optionsJSON = await fetch("/api/auth/passkey/register/options", { method: "POST" }).then((r) => r.json());
      const response = await startRegistration({ optionsJSON });
      const result = await sendJson("POST", "/api/auth/passkey/register/verify", { response, name });
      if (!result.ok) throw new Error(result.error);
      setName("");
      router.refresh();
    } catch (cause) {
      const n = cause instanceof Error ? cause.name : "";
      setError(n === "NotAllowedError" ? "Passkey setup was cancelled" : cause instanceof Error ? cause.message : "Could not add passkey");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Remove this passkey?")) return;
    const result = await sendJson("DELETE", `/api/auth/passkeys/${id}`);
    if (!result.ok) setError(result.error);
    else router.refresh();
  }

  return (
    <div className="space-y-4">
      {passkeys.length === 0 ? (
        <p className="text-caption text-ink-muted">No passkeys yet. Add one to sign in with your device&apos;s unlock instead of a password.</p>
      ) : (
        <ul className="divide-y divide-line">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-3">
              <div className="flex-1">
                <div className="font-medium">{p.name || "Passkey"}</div>
                <div className="text-caption text-ink-muted">
                  Added {formatDate(new Date(p.createdAt))}
                  {p.lastUsedAt ? ` · last used ${formatDate(new Date(p.lastUsedAt))}` : ""}
                </div>
              </div>
              <Button variant="ghost" onClick={() => remove(p.id)} className="text-danger">Remove</Button>
            </li>
          ))}
        </ul>
      )}
      {supported ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-1 flex-col gap-1 text-caption text-ink-muted">
            <span className="font-medium">Passkey name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Laptop" maxLength={80} className={inputClass} />
          </label>
          <Button onClick={add} disabled={busy}>{busy ? "Waiting for device…" : "Add passkey"}</Button>
        </div>
      ) : (
        <p className="text-caption text-ink-muted">This browser doesn&apos;t support passkeys.</p>
      )}
      <FormError message={error} />
    </div>
  );
}
