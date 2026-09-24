"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, inputClass } from "@/components/ui/field";
import { sendJson } from "@/lib/client/api";
import { parseCsv, type ParsedCsv } from "@/lib/csv";
import type { Provider } from "@/lib/db/schema";
import type { ImportRowInput } from "@/lib/import/orders";
import type { Money } from "@/lib/money";

type TargetField = keyof ImportRowInput;

const TARGETS: { key: TargetField; label: string; required: boolean; hints: string[] }[] = [
  { key: "date", label: "Purchase date", required: true, hints: ["date", "purchased", "order date"] },
  { key: "merchant", label: "Merchant", required: true, hints: ["merchant", "store", "shop", "retailer"] },
  { key: "reference", label: "Order number", required: true, hints: ["order no", "order number", "reference", "order id", "id"] },
  { key: "totalAmount", label: "Order amount", required: true, hints: ["order amount", "amount", "total"] },
  { key: "amountOwing", label: "Amount owing", required: true, hints: ["owing", "owed", "balance", "remaining"] },
  { key: "channel", label: "Channel", required: false, hints: ["channel", "type"] },
  { key: "status", label: "Status", required: false, hints: ["status", "state"] },
];

interface Preview {
  valid: number;
  invalid: number;
  errors: { line: number; message: string }[];
  statusMismatches: number;
  total: Money;
  owing: Money;
  sample: { merchant: string; reference: string; purchasedOn: string; total: Money; owing: Money; firstDueOn?: string; paidInstalments: number }[];
}

function guessMapping(headers: string[]): Partial<Record<TargetField, string>> {
  const mapping: Partial<Record<TargetField, string>> = {};
  const taken = new Set<string>();
  for (const target of TARGETS) {
    const match = headers.find(
      (h) => !taken.has(h) && target.hints.some((hint) => h.toLowerCase().includes(hint)),
    );
    if (match) {
      mapping[target.key] = match;
      taken.add(match);
    }
  }
  return mapping;
}

export function CsvImport({ providers }: { providers: Provider[] }) {
  const router = useRouter();
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<Partial<Record<TargetField, string>>>({});
  const [providerName, setProviderName] = useState(providers[0]?.name ?? "");
  const [newProvider, setNewProvider] = useState(providers.length === 0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const missing = useMemo(
    () => TARGETS.filter((t) => t.required && !mapping[t.key]).map((t) => t.label),
    [mapping],
  );

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

  function mappedRows(): ImportRowInput[] {
    return (csv?.rows ?? []).map((row) => ({
      date: row[mapping.date ?? ""] ?? "",
      merchant: row[mapping.merchant ?? ""] ?? "",
      reference: row[mapping.reference ?? ""] ?? "",
      totalAmount: row[mapping.totalAmount ?? ""] ?? "",
      amountOwing: row[mapping.amountOwing ?? ""] ?? "",
      channel: mapping.channel ? row[mapping.channel] : undefined,
      status: mapping.status ? row[mapping.status] : undefined,
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
        providerKind: String(data.get("providerKind") ?? "bnpl"),
        instalmentCount: String(data.get("instalmentCount") ?? "4"),
        intervalDays: String(data.get("intervalDays") ?? "14"),
        cycleAnchor: String(data.get("cycleAnchor") ?? ""),
        replace: data.get("replace") === "on",
        updateExisting: data.get("updateExisting") === "on",
      },
    };
    const res = await sendJson<Preview | { imported: number; updated: number; skipped: number }>("POST", "/api/import/csv", body);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (mode === "preview") setPreview(res.data as Preview);
    else {
      const r = res.data as { imported: number; updated: number; skipped: number };
      const parts = [
        `${r.imported} orders added`,
        r.updated ? `${r.updated} already present brought up to date` : null,
        r.skipped ? `${r.skipped} already present and unchanged` : null,
      ].filter(Boolean);
      setResult(`${parts.join(", ")}.`);
      setPreview(null);
      setCsv(null);
      router.refresh();
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(preview && preview.invalid === 0 ? "commit" : "preview", e.currentTarget);
      }}
      className="space-y-5"
    >
      <Field label="CSV file" hint="Exported order history with one row per order">
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
              <Field key={t.key} label={`${t.label}${t.required ? "" : " (optional)"}`}>
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
            <legend className="mb-2 text-body font-semibold">How to import</legend>
            <Field label="Provider" hint="Who these orders are owed to">
              {newProvider ? (
                <input value={providerName} onChange={(e) => setProviderName(e.target.value)} required className={inputClass} placeholder="Provider name" />
              ) : (
                <select value={providerName} onChange={(e) => setProviderName(e.target.value)} className={inputClass}>
                  {providers.map((p) => (
                    <option key={p.id} value={p.name}>{p.name}</option>
                  ))}
                </select>
              )}
            </Field>
            <div className="flex items-end gap-3">
              {newProvider ? (
                <Field label="Type">
                  <select name="providerKind" defaultValue="bnpl" className={inputClass}>
                    <option value="bnpl">Buy now, pay later</option>
                    <option value="store_finance">Store finance</option>
                    <option value="loan">Loan</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
              ) : null}
              {providers.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setNewProvider(!newProvider);
                    setProviderName(newProvider ? (providers[0]?.name ?? "") : "");
                  }}
                  className="pb-2 text-caption font-medium text-ink-muted underline underline-offset-2"
                >
                  {newProvider ? "Choose existing" : "New provider"}
                </button>
              ) : null}
            </div>
            <Field label="Instalments per order">
              <input type="number" name="instalmentCount" min={1} max={60} defaultValue={4} className={inputClass} />
            </Field>
            <Field label="Days between instalments">
              <input type="number" name="intervalDays" min={1} max={366} defaultValue={14} className={inputClass} />
            </Field>
            <Field label="Collection cycle day (optional)" hint="Any due date from the provider, if they collect on fixed days">
              <input type="date" name="cycleAnchor" className={inputClass} />
            </Field>
            <div className="flex flex-col gap-2 self-end pb-2 text-caption text-ink-secondary">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="updateExisting" defaultChecked className="size-4" />
                Update orders already present to the export&apos;s amount owing
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="replace" className="size-4" />
                Replace this provider&apos;s existing orders (deletes them first)
              </label>
            </div>
          </fieldset>

          {missing.length ? (
            <p className="text-caption text-warning">Still to match: {missing.join(", ")}</p>
          ) : null}

          {preview ? (
            <div className="rounded-chip bg-surface-sunken px-4 py-3 text-caption">
              <p className="text-body">
                <strong>{preview.valid}</strong> rows ready · <strong>{preview.invalid}</strong> with problems ·
                total {preview.total.symbol}{preview.total.amount} · owing {preview.owing.symbol}{preview.owing.amount}
              </p>
              {preview.statusMismatches ? (
                <p className="mt-1 text-warning">{preview.statusMismatches} rows where the status column disagrees with the amount owing (the amount wins).</p>
              ) : null}
              {preview.errors.length ? (
                <ul className="mt-2 list-disc pl-5 text-danger">
                  {preview.errors.map((e) => (
                    <li key={e.line}>Line {e.line}: {e.message}</li>
                  ))}
                </ul>
              ) : null}
              {preview.sample.length ? (
                <table className="data-table mt-3">
                  <thead>
                    <tr><th>Merchant</th><th>Order no.</th><th>Purchased</th><th>First due</th><th className="text-right">Amount</th><th className="text-right">Owing</th></tr>
                  </thead>
                  <tbody>
                    {preview.sample.map((r) => (
                      <tr key={r.reference}>
                        <td data-label="Merchant">{r.merchant}</td>
                        <td data-label="Order no.">{r.reference}</td>
                        <td data-label="Purchased">{r.purchasedOn}</td>
                        <td data-label="First due">{r.firstDueOn}</td>
                        <td data-label="Amount" className="text-right">{r.total.symbol}{r.total.amount}</td>
                        <td data-label="Owing" className="text-right">{r.owing.symbol}{r.owing.amount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          ) : null}

          <FormError message={error} />
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy || missing.length > 0 || !providerName}>
              {busy ? "Working…" : preview && preview.invalid === 0 ? `Import ${preview.valid} rows` : "Preview"}
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
