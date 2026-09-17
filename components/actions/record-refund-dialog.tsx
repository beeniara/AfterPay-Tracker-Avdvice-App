"use client";

import { useState } from "react";
import { ActionForm } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, inputClass } from "@/components/ui/field";

export function RecordRefundDialog({
  orderId,
  currency,
  today,
}: {
  orderId: string;
  currency: string;
  today: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Record refund
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Record a refund">
        <ActionForm
          method="POST"
          url={`/api/orders/${orderId}/refunds`}
          submitLabel="Record refund"
          onCancel={() => setOpen(false)}
          onDone={() => setOpen(false)}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Amount (${currency})`}>
              <input name="amount" inputMode="decimal" required className={inputClass} />
            </Field>
            <Field label="Refunded on">
              <input type="date" name="refundedOn" required defaultValue={today} className={inputClass} />
            </Field>
          </div>
          <Field label="Note">
            <input name="note" className={inputClass} />
          </Field>
        </ActionForm>
      </Dialog>
    </>
  );
}
