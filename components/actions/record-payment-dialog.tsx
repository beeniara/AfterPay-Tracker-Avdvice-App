"use client";

import { useState } from "react";
import { ActionForm } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, inputClass } from "@/components/ui/field";
import { toMoney } from "@/lib/money";

export function RecordPaymentDialog({
  instalmentId,
  currency,
  defaultAmountCents,
  today,
  description,
  triggerLabel = "Mark paid",
  variant = "primary",
  className,
}: {
  instalmentId: string;
  currency: string;
  defaultAmountCents: number;
  today: string;
  description: string;
  triggerLabel?: string;
  variant?: "primary" | "prominent" | "ghost";
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant={variant} className={className} onClick={() => setOpen(true)}>
        {triggerLabel}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Record a payment">
        <p className="mb-4 text-caption text-ink-muted">{description}</p>
        <ActionForm
          method="POST"
          url={`/api/instalments/${instalmentId}/payments`}
          submitLabel="Record payment"
          onCancel={() => setOpen(false)}
          onDone={() => setOpen(false)}
        >
          <Field label={`Amount (${currency})`}>
            <input
              name="amount"
              inputMode="decimal"
              required
              defaultValue={toMoney(defaultAmountCents, currency).amount}
              className={inputClass}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Paid on">
              <input type="date" name="paidOn" required defaultValue={today} className={inputClass} />
            </Field>
            <Field label="Method">
              <select name="method" defaultValue="card" className={inputClass}>
                <option value="card">Card</option>
                <option value="bank">Bank</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select>
            </Field>
          </div>
          <Field label="Reference" hint="Optional — receipt or transaction id">
            <input name="reference" className={inputClass} />
          </Field>
          <label className="flex items-center gap-2 text-caption text-ink-secondary">
            <input type="checkbox" name="pending" className="size-4" />
            Taken but not cleared yet (pending)
          </label>
        </ActionForm>
      </Dialog>
    </>
  );
}
