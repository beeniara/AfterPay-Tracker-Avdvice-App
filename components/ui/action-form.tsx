"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { formToObject, sendJson } from "@/lib/client/api";

// A form that POSTs/PATCHes JSON to an API route, then refreshes server data.
export function ActionForm({
  method,
  url,
  submitLabel,
  onDone,
  onCancel,
  children,
}: {
  method: "POST" | "PATCH";
  url: string;
  submitLabel: string;
  onDone?: (data: unknown) => void;
  onCancel?: () => void;
  children: ReactNode;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await sendJson(method, url, formToObject(event.currentTarget));
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    router.refresh();
    setBusy(false);
    onDone?.(result.data);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {children}
      <FormError message={error} />
      <div className="flex justify-end gap-3 pt-1">
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
