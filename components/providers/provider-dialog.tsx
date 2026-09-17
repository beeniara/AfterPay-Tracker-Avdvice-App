"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionForm } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, inputClass } from "@/components/ui/field";
import { sendJson } from "@/lib/client/api";
import type { Provider } from "@/lib/db/schema";

export function ProviderDialog({ provider }: { provider?: Provider }) {
  const [open, setOpen] = useState(false);
  const editing = Boolean(provider);

  return (
    <>
      <Button variant={editing ? "ghost" : "prominent"} onClick={() => setOpen(true)}>
        {editing ? "Edit" : "Add provider"}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={editing ? "Edit provider" : "Add a provider"}>
        <ActionForm
          method={editing ? "PATCH" : "POST"}
          url={editing ? `/api/providers/${provider!.id}` : "/api/providers"}
          submitLabel={editing ? "Save" : "Add provider"}
          onCancel={() => setOpen(false)}
          onDone={() => setOpen(false)}
        >
          <Field label="Name">
            <input name="name" required maxLength={120} defaultValue={provider?.name ?? ""} className={inputClass} />
          </Field>
          <Field label="Type">
            <select name="kind" defaultValue={provider?.kind ?? "bnpl"} className={inputClass}>
              <option value="bnpl">Buy now, pay later</option>
              <option value="store_finance">Store finance</option>
              <option value="loan">Loan</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Website">
              <input name="website" defaultValue={provider?.website ?? ""} className={inputClass} />
            </Field>
            <Field label="Support phone">
              <input name="supportPhone" defaultValue={provider?.supportPhone ?? ""} className={inputClass} />
            </Field>
          </div>
          <Field label="Notes">
            <textarea name="notes" rows={2} defaultValue={provider?.notes ?? ""} className={`${inputClass} h-auto py-2`} />
          </Field>
        </ActionForm>
      </Dialog>
    </>
  );
}

export function DeleteProviderButton({ provider }: { provider: Provider }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!confirm(`Delete ${provider.name}?`)) return;
    const result = await sendJson("DELETE", `/api/providers/${provider.id}`);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <span className="flex items-center gap-2">
      <Button variant="ghost" onClick={remove} className="text-danger">
        Delete
      </Button>
      {error ? <span role="alert" className="text-caption text-danger">{error}</span> : null}
    </span>
  );
}
