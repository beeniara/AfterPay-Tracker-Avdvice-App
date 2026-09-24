"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, FormError } from "@/components/ui/field";
import type { AdvicePlan } from "@/lib/ask/advice-prompt";
import type { ModelStatus } from "@/lib/ask/ollama";
import { sendJson } from "@/lib/client/api";
import { publishStatus, useModelStatus } from "@/lib/client/model-status";
import { sayIfUnmuted, speak, speechSupported } from "@/lib/client/speak";
import { formatCents, formatDate } from "@/lib/format";

// Keep in step with MAX_CONTEXT_CHARS in lib/ask/advice-prompt.ts (not imported:
// that module would pull zod into the browser bundle).
const MAX_NOTE_CHARS = 600;
const HISTORY_COLLAPSED = 3;

interface AdviceResponse {
  id: string;
  plan: AdvicePlan;
  model: string;
  ordersShown: number;
  ordersTotal: number;
  durationMs: number;
}

interface AdviceHistoryItem {
  id: string;
  question: string;
  note: string | null;
  model: string | null;
  error: string | null;
  durationMs: number;
  createdAt: string;
  plan: AdvicePlan | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function formatWhen(when: string): string {
  return ISO_DATE.test(when) ? formatDate(when, "dayMonth") : when;
}

function seconds(ms: number): string {
  return `${Math.max(1, Math.round(ms / 1000))}s`;
}

function PlanCard({ plan, currency, footer }: { plan: AdvicePlan; currency: string; footer: string }) {
  const [canSpeak, setCanSpeak] = useState(false);
  useEffect(() => setCanSpeak(speechSupported()), []);

  return (
    <div className="grid gap-4 rounded-card border-l-4 border-highlight-strong bg-highlight p-4 shadow-sm">
      <p className="text-heading">{plan.summary}</p>

      <ol className="grid list-decimal gap-3 pl-5">
        {plan.steps.map((step, index) => (
          <li key={index} className="pl-1">
            <p className="text-body font-semibold">{step.title}</p>
            {step.detail ? <p className="text-body text-ink-secondary">{step.detail}</p> : null}
            {step.when || step.amountCents !== undefined ? (
              <p className="mt-1.5 flex flex-wrap gap-2">
                {step.when ? <Badge>{formatWhen(step.when)}</Badge> : null}
                {step.amountCents !== undefined ? (
                  <Badge tone="prominent" className="tabular-nums">
                    {formatCents(step.amountCents, currency)}
                  </Badge>
                ) : null}
              </p>
            ) : null}
          </li>
        ))}
      </ol>

      {plan.warnings.length > 0 ? (
        <ul className="grid gap-2">
          {plan.warnings.map((warning, index) => (
            <li key={index} className="flex items-start gap-2 text-body text-ink-secondary">
              <Badge tone="warning" className="shrink-0">
                Watch out
              </Badge>
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {plan.closing ? <p className="text-body">{plan.closing}</p> : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {canSpeak ? (
          <Button variant="ghost" className="px-3 py-1.5 text-caption" onClick={() => speak(plan.summary)}>
            Read aloud
          </Button>
        ) : null}
        <p className="min-w-0 flex-1 text-caption text-ink-muted">
          {footer}. Guidance from a model on your PC, so it can be wrong; check dates against Upcoming before paying.
        </p>
      </div>
    </div>
  );
}

export function AdviceBox({ currency, activeOrders }: { currency: string; activeOrders: number }) {
  // The Ask box (further down the page) polls the PC and publishes what it finds.
  const status = useModelStatus();
  const ready = status !== "checking" && status.state === "ready";
  const [context, setContext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AdviceResponse | null>(null);
  const [history, setHistory] = useState<AdviceHistoryItem[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const response = await fetch("/api/ask/history?kind=advice");
      if (response.ok) setHistory(((await response.json()) as { mine: AdviceHistoryItem[] }).mine);
    } catch {
      // History is a convenience; the card still works without it.
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const note = context.trim();
    const res = await sendJson<AdviceResponse | { status: ModelStatus }>("POST", "/api/ask/advice", note ? { context: note } : {});
    setBusy(false);
    if (!res.ok) {
      // A 503 with only a status body (model went away between polls) reaches us as a bare code.
      setError(
        /\(503\)/.test(res.error)
          ? "Assistance Beeniara isn't answering right now. Check the panel under “Ask about your orders”, then try again."
          : res.error,
      );
      void loadHistory();
      return;
    }
    if ("status" in res.data) {
      publishStatus(res.data.status);
      return;
    }
    setResult(res.data);
    sayIfUnmuted(res.data.plan.summary);
    void loadHistory();
  }

  async function remove(id: string) {
    const res = await sendJson("DELETE", `/api/ask/history/${id}`);
    if (res.ok) {
      setHistory((items) => items.filter((item) => item.id !== id));
      if (result?.id === id) setResult(null);
    }
  }

  if (activeOrders === 0) {
    return (
      <EmptyState
        glyph="✓"
        title="Nothing to plan"
        description="There are no active orders, so there is nothing to pay off."
        action={<ButtonLink href="/orders">See orders</ButtonLink>}
      />
    );
  }

  const visible = showAll ? history : history.slice(0, HISTORY_COLLAPSED);

  return (
    <div>
      <form onSubmit={submit} className="grid gap-3">
        <Field label="Anything Beeniara should know? (optional)" hint="Paydays, what you can spare, dates to avoid.">
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={2}
            maxLength={MAX_NOTE_CHARS}
            placeholder="e.g. I get paid fortnightly on Thursdays and can spare $300 a fortnight."
            className="w-full rounded-chip border border-line bg-surface px-3 py-2 text-body text-ink placeholder:text-ink-subtle"
          />
        </Field>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button type="submit" disabled={busy || !ready}>
            {busy ? "Studying your orders…" : "Get advice"}
          </Button>
          <span className="text-caption text-ink-muted tabular-nums">
            {context.length}/{MAX_NOTE_CHARS}
          </span>
          <span className="text-caption text-ink-muted">
            Reads every active order on your PC; nothing leaves your own machines. Can take a minute.
          </span>
        </div>
        {!ready ? (
          <p className="text-caption text-ink-secondary">
            {status === "checking" ? (
              "Checking whether Assistance Beeniara is on…"
            ) : (
              <>
                Assistance Beeniara isn&apos;t ready yet. Start or check it under{" "}
                <a href="#ask" className="font-medium underline underline-offset-2">
                  Ask about your orders
                </a>{" "}
                below.
              </>
            )}
          </p>
        ) : null}
        {busy ? (
          <p role="status" aria-live="polite" className="text-body text-ink-secondary">
            Reading {activeOrders} active {activeOrders === 1 ? "order" : "orders"} and working out a plan…
          </p>
        ) : null}
      </form>

      <div className="mt-3 grid gap-3">
        <FormError message={error} />
        {result ? (
          <PlanCard
            plan={result.plan}
            currency={currency}
            footer={`Based on ${result.ordersShown} of ${result.ordersTotal} active orders · ${result.model} · ${seconds(result.durationMs)}`}
          />
        ) : null}
      </div>

      {history.length > 0 ? (
        <div className="mt-6">
          <h3 className="mb-2 text-body font-semibold">Previous advice</h3>
          <ol className="divide-y divide-line">
            {visible.map((item) => {
              const expanded = open === item.id;
              const label = item.question ? item.question : "No extra note";
              return (
                <li key={item.id} className="py-3">
                  <div className="flex flex-col gap-2 rail:flex-row rail:items-start rail:gap-4">
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : item.id)}
                      aria-expanded={expanded}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate font-medium">{label}</span>
                      <span className="block text-caption text-ink-muted">
                        {formatDate(new Date(item.createdAt), "long")}
                        {item.error ? " · didn't work" : ""}
                        {item.durationMs ? ` · ${seconds(item.durationMs)}` : ""}
                        {expanded ? " · tap to hide" : " · tap to see the plan"}
                      </span>
                    </button>
                    <div className="flex shrink-0 gap-2">
                      {ready && item.question ? (
                        <Button variant="ghost" className="px-3 py-1.5 text-caption" onClick={() => setContext(item.question)}>
                          Use this note again
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        className="px-3 py-1.5 text-caption"
                        onClick={() => void remove(item.id)}
                        aria-label={`Delete the advice from ${formatDate(new Date(item.createdAt), "long")}`}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                  {expanded ? (
                    <div className="mt-3">
                      {item.error ? (
                        <p className="rounded-chip bg-danger-tint px-3 py-2 text-caption text-danger">{item.error}</p>
                      ) : item.plan ? (
                        <PlanCard
                          plan={item.plan}
                          currency={currency}
                          footer={`${item.note ?? "Saved plan"}${item.model ? ` · ${item.model}` : ""}`}
                        />
                      ) : (
                        <p className="rounded-chip bg-surface-sunken px-3 py-2 text-caption text-ink-muted">This saved plan couldn&apos;t be read.</p>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {history.length > HISTORY_COLLAPSED ? (
            <button
              type="button"
              onClick={() => setShowAll(!showAll)}
              className="mt-2 text-caption font-medium text-ink-muted underline underline-offset-2"
            >
              {showAll ? "Show fewer" : `Show all ${history.length}`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
