"use client";

import { useState } from "react";
import { ActionForm } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, inputClass } from "@/components/ui/field";

export function RecordFeeDialog({
  instalmentId,
  currency,
  today,
  description,
}: {
  instalmentId: string;
  currency: string;
  today: string;
  description: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Add fee
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Record a fee">
        <p className="mb-4 text-caption text-ink-muted">{description}</p>
        <ActionForm
          method="POST"
          url={`/api/instalments/${instalmentId}/fees`}
          submitLabel="Record fee"
          onCancel={() => setOpen(false)}
          onDone={() => setOpen(false)}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Amount (${currency})`}>
              <input name="amount" inputMode="decimal" required className={inputClass} />
            </Field>
            <Field label="Type">
              <select name="kind" defaultValue="late" className={inputClass}>
                <option value="late">Late fee</option>
                <option value="establishment">Establishment fee</option>
                <option value="other">Other</option>
              </select>
            </Field>
          </div>
          <Field label="Incurred on">
            <input type="date" name="incurredOn" required defaultValue={today} className={inputClass} />
          </Field>
          <Field label="Note">
            <input name="note" className={inputClass} />
          </Field>
        </ActionForm>
      </Dialog>
    </>
  );
}
