"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, inputClass } from "@/components/ui/field";
import { sendJson } from "@/lib/client/api";
import { parseCsv, type ParsedCsv } from "@/lib/csv";
import type { Provider } from "@/lib/db/schema";
import type { UpcomingRowInput } from "@/lib/import/upcoming";
import type { Money } from "@/lib/money";

type TargetField = keyof UpcomingRowInput;

const TARGETS: { key: TargetField; label: string; hints: string[] }[] = [
  { key: "merchant", label: "Merchant", hints: ["merchant", "store", "shop", "retailer"] },
  { key: "paymentNo", label: "Payment number", hints: ["payment no", "payment number", "instalment", "installment", "payment"] },
  { key: "dueDate", label: "Due date", hints: ["due", "date"] },
  { key: "amount", label: "Amount due", hints: ["amount", "due (", "total"] },
];

interface Detail {
  action: "update" | "reopen" | "settle" | "create";
  merchant: string;
  reference: string | null;
  purchasedOn: string;
  detail: string;
}

interface Preview {
  valid: number;
  invalid: number;
  errors: { line: number; message: string }[];
  orders: number;
  updated: number;
  reopened: number;
  created: number;
  settled: number;
  unchanged: number;
  redated: number;
  markedPaid: number;
  reopenedInstalments: number;
  upcoming: Money;
  owingBefore: Money;
  owingAfter: Money;
  details: Detail[];
  moreDetails: number;
}

const ACTION_LABEL: Record<Detail["action"], string> = {
  update: "Update",
  reopen: "Re-open",
  settle: "Paid off",
  create: "New order",
};

function guessMapping(headers: string[]): Partial<Record<TargetField, string>> {
  const mapping: Partial<Record<TargetField, string>> = {};
  const taken = new Set<string>();
  for (const target of TARGETS) {
    const match = headers.find((h) => !taken.has(h) && target.hints.some((hint) => h.toLowerCase().includes(hint)));
    if (match) {
      mapping[target.key] = match;
      taken.add(match);
    }
  }
  return mapping;
}

function money(m: Money): string {
  return `${m.symbol}${m.amount}`;
}

export function UpcomingImport({ providers }: { providers: Provider[] }) {
  const router = useRouter();
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<Partial<Record<TargetField, string>>>({});
  const [providerName, setProviderName] = useState(providers[0]?.name ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const missing = useMemo(() => TARGETS.filter((t) => !mapping[t.key]).map((t) => t.label), [mapping]);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const parsed = parseCsv(await file.text());
    setCsv(parsed);
    setFileName(file.name);
    setMapping(guessMapping(parsed.headers));
    setPreview(null);
    setResult(null);
    setError(null);
  }

  function mappedRows(): UpcomingRowInput[] {
    return (csv?.rows ?? []).map((row) => ({
      merchant: row[mapping.merchant ?? ""] ?? "",
      paymentNo: row[mapping.paymentNo ?? ""] ?? "",
      dueDate: row[mapping.dueDate ?? ""] ?? "",
      amount: row[mapping.amount ?? ""] ?? "",
    }));
  }

  async function run(mode: "preview" | "commit", form: HTMLFormElement) {
    setBusy(true);
    setError(null);
    const data = new FormData(form);
    const body = {
      mode,
      rows: mappedRows(),
      options: {
        providerName,
        intervalDays: String(data.get("intervalDays") ?? "14"),
        reopenSettled: data.get("reopenSettled") === "on",
        settleMissing: data.get("settleMissing") === "on",
        createUnmatched: data.get("createUnmatched") === "on",
      },
    };
    const res = await sendJson<Preview>("POST", "/api/import/upcoming", body);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (mode === "preview") setPreview(res.data);
    else {
      const r = res.data;
      const parts = [
        r.updated ? `${r.updated} orders updated` : null,
        r.reopened ? `${r.reopened} re-opened` : null,
        r.created ? `${r.created} added` : null,
        r.settled ? `${r.settled} marked paid off` : null,
      ].filter(Boolean);
      setResult(`Done: ${parts.length ? parts.join(", ") : "nothing needed changing"}. Owing is now ${money(r.owingAfter)}.`);
      setPreview(null);
      setCsv(null);
      router.refresh();
    }
  }

  const ready = preview !== null && preview.invalid === 0;
  const nothingToDo = ready && preview.updated + preview.reopened + preview.created + preview.settled === 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(ready ? "commit" : "preview", e.currentTarget);
      }}
      className="space-y-5"
    >
      <Field label="CSV file" hint="The provider's upcoming-payments export: one row per instalment still to pay">
        <input type="file" accept=".csv,text/csv" onChange={onFile} className="text-body" />
      </Field>

      {csv ? (
        <>
          <p className="text-caption text-ink-muted">
            <strong>{fileName}</strong> · {csv.rows.length.toLocaleString("en-NZ")} rows · {csv.headers.length} columns
          </p>
          <fieldset className="grid gap-3 md:grid-cols-2">
            <legend className="mb-2 text-body font-semibold">Match columns</legend>
            {TARGETS.map((t) => (
              <Field key={t.key} label={t.label}>
                <select
                  value={mapping[t.key] ?? ""}
                  onChange={(e) => {
                    setMapping({ ...mapping, [t.key]: e.target.value || undefined });
                    setPreview(null);
                  }}
                  className={inputClass}
                >
                  <option value="">—</option>
                  {csv.headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </Field>
            ))}
          </fieldset>

          <fieldset className="grid gap-3 md:grid-cols-2">
            <legend className="mb-2 text-body font-semibold">How to reconcile</legend>
            <Field label="Provider" hint="Whose orders to update">
              {providers.length ? (
                <select value={providerName} onChange={(e) => { setProviderName(e.target.value); setPreview(null); }} className={inputClass}>
                  {providers.map((p) => (
                    <option key={p.id} value={p.name}>{p.name}</option>
                  ))}
                </select>
              ) : (
                <input value={providerName} onChange={(e) => setProviderName(e.target.value)} required className={inputClass} placeholder="Provider name" />
              )}
            </Field>
            <Field label="Days between instalments">
              <input type="number" name="intervalDays" min={1} max={366} defaultValue={14} className={inputClass} onChange={() => setPreview(null)} />
            </Field>
            <div className="flex flex-col gap-2 text-caption text-ink-secondary md:col-span-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="settleMissing" defaultChecked className="size-4" onChange={() => setPreview(null)} />
                Mark active orders that aren&apos;t in the export as paid off
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="reopenSettled" defaultChecked className="size-4" onChange={() => setPreview(null)} />
                Re-open settled orders the export still lists a payment for
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="createUnmatched" defaultChecked className="size-4" onChange={() => setPreview(null)} />
                Add orders the app has never seen (purchase date and total estimated)
              </label>
            </div>
          </fieldset>

          {missing.length ? <p className="text-caption text-warning">Still to match: {missing.join(", ")}</p> : null}

          {preview ? (
            <div className="rounded-chip bg-surface-sunken px-4 py-3 text-caption">
              <p className="text-body">
                <strong>{preview.valid}</strong> instalments across <strong>{preview.orders}</strong> orders
                {preview.invalid ? <> · <strong>{preview.invalid}</strong> rows with problems</> : null}
                {" "}· export says {money(preview.upcoming)} still to pay
              </p>
              <p className="mt-1 text-body">
                Owing {money(preview.owingBefore)} now → <strong>{money(preview.owingAfter)}</strong> after
              </p>
              <ul className="mt-2 grid gap-x-6 gap-y-1 text-ink-secondary sm:grid-cols-2">
                <li>{preview.updated} active orders updated ({preview.unchanged} already correct)</li>
                <li>{preview.reopened} settled orders re-opened</li>
                <li>{preview.created} orders added</li>
                <li>{preview.settled} active orders marked paid off</li>
                <li>{preview.redated} instalments re-dated</li>
                <li>{preview.markedPaid} marked paid · {preview.reopenedInstalments} re-opened</li>
              </ul>
              {preview.errors.length ? (
                <ul className="mt-2 list-disc pl-5 text-danger">
                  {preview.errors.map((e) => (
                    <li key={e.line}>Line {e.line}: {e.message}</li>
                  ))}
                </ul>
              ) : null}
              {preview.details.length ? (
                <table className="data-table mt-3">
                  <thead>
                    <tr><th>Action</th><th>Merchant</th><th>Order no.</th><th>Purchased</th><th>Change</th></tr>
                  </thead>
                  <tbody>
                    {preview.details.map((d, i) => (
                      <tr key={i}>
                        <td data-label="Action">{ACTION_LABEL[d.action]}</td>
                        <td data-label="Merchant">{d.merchant}</td>
                        <td data-label="Order no.">{d.reference ?? "—"}</td>
                        <td data-label="Purchased">{d.purchasedOn}</td>
                        <td data-label="Change">{d.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {preview.moreDetails ? <p className="mt-2 text-ink-muted">…and {preview.moreDetails} more.</p> : null}
            </div>
          ) : null}

          <FormError message={error} />
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy || missing.length > 0 || !providerName || nothingToDo}>
              {busy ? "Working…" : nothingToDo ? "Already up to date" : ready ? "Apply these changes" : "Preview"}
            </Button>
            {preview ? (
              <button type="button" onClick={() => setPreview(null)} className="text-caption font-medium text-ink-muted underline underline-offset-2">
                Change settings
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {result ? <p className="text-body text-success">{result}</p> : null}
    </form>
  );
}
