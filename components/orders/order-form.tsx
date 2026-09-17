"use client";

import { useRouter } from "next/navigation";
import { ActionForm } from "@/components/ui/action-form";
import { Field, inputClass } from "@/components/ui/field";
import type { Provider } from "@/lib/db/schema";

export interface OrderFormValues {
  id?: string;
  providerId?: string;
  merchant?: string;
  reference?: string | null;
  channel?: "online" | "in_store";
  purchasedOn?: string;
  totalAmount?: string;
  instalmentCount?: number;
  intervalDays?: number;
  notes?: string | null;
}

export function OrderForm({
  providers,
  currency,
  today,
  initial,
}: {
  providers: Provider[];
  currency: string;
  today: string;
  initial?: OrderFormValues;
}) {
  const router = useRouter();
  const editing = Boolean(initial?.id);

  return (
    <ActionForm
      method={editing ? "PATCH" : "POST"}
      url={editing ? `/api/orders/${initial!.id}` : "/api/orders"}
      submitLabel={editing ? "Save changes" : "Add order"}
      onCancel={() => router.back()}
      onDone={(data) => {
        const id = editing ? initial!.id : (data as { id: string }).id;
        router.push(`/orders/${id}`);
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Provider" hint="Who you owe the money to">
          <select name="providerId" required defaultValue={initial?.providerId ?? providers[0]?.id} className={inputClass}>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Merchant" hint="Where you bought it">
          <input name="merchant" required maxLength={200} defaultValue={initial?.merchant ?? ""} className={inputClass} />
        </Field>
        <Field label="Order number" hint="Optional — theirs or your own">
          <input name="reference" maxLength={100} defaultValue={initial?.reference ?? ""} className={inputClass} />
        </Field>
        <Field label="Channel">
          <select name="channel" defaultValue={initial?.channel ?? "online"} className={inputClass}>
            <option value="online">Online</option>
            <option value="in_store">In-store</option>
          </select>
        </Field>
        <Field label="Purchase date">
          <input type="date" name="purchasedOn" required defaultValue={initial?.purchasedOn ?? today} className={inputClass} />
        </Field>
        {!editing ? (
          <>
            <Field label={`Order amount (${currency})`}>
              <input name="totalAmount" inputMode="decimal" required placeholder="0.00" className={inputClass} />
            </Field>
            <Field label="Number of instalments">
              <input type="number" name="instalmentCount" min={1} max={60} required defaultValue={4} className={inputClass} />
            </Field>
            <Field label="Days between instalments">
              <input type="number" name="intervalDays" min={1} max={366} required defaultValue={14} className={inputClass} />
            </Field>
            <Field label="First instalment due" hint="Leave blank to use the purchase date">
              <input type="date" name="firstDueOn" className={inputClass} />
            </Field>
          </>
        ) : (
          <p className="text-caption text-ink-muted md:col-span-2">
            Amounts and the schedule can&apos;t be edited once instalments exist — record payments,
            fees and refunds on the order page instead, or delete and re-add it.
          </p>
        )}
        <Field label="Notes" className="md:col-span-2">
          <textarea name="notes" rows={3} maxLength={2000} defaultValue={initial?.notes ?? ""} className={`${inputClass} h-auto py-2`} />
        </Field>
      </div>
    </ActionForm>
  );
}
