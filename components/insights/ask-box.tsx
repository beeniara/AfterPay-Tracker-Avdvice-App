"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { sendJson } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import type { ModelStatus } from "@/lib/ask/ollama";
import { isMoneyColumn, type ResultTable } from "@/lib/ask/prompt";
import { formatCents, formatDate } from "@/lib/format";

interface AskResponse {
  id: string;
  answer: string;
  note: string;
  sql: string;
  table: ResultTable | null;
  model: string;
}

interface HistoryItem {
  id: string;
  question: string;
  answer: string | null;
  sql: string | null;
  note: string | null;
  model: string | null;
  rowCount: number | null;
  error: string | null;
  durationMs: number;
  createdAt: string;
}

interface History {
  mine: HistoryItem[];
  shared: string[];
}

// GET /api/ask returns the model status plus wake info (see the route).
type StatusResponse = ModelStatus & { canWake?: boolean; canShutdown?: boolean; waking?: boolean };

// The panel re-checks the PC on its own this often, so it follows the PC on/off without a click.
const LIVE_POLL_MS = 5_000;
const WAKE_GIVE_UP_MS = 2 * 60 * 1000;
// Seconds the user can still cancel after pressing "Shut down PC".
const SHUTDOWN_GRACE_S = 10;
// The PC's locked SSH key runs `shutdown /s /t 5`, so it goes off about 5s after we send.
const SHUTDOWN_PC_DELAY_S = 5;

type ShutdownState = { phase: "pending" | "sending" | "off"; left: number } | null;

const EXAMPLES = [
  "How much did I spend at each shop this year?",
  "Which orders still have more than two payments left?",
  "What did I buy last December?",
  "Which payments are overdue right now?",
];

function Guidance({ status }: { status: ModelStatus }) {
  const step = "block text-body text-ink-secondary";
  switch (status.state) {
    case "unconfigured":
      return (
        <p className={step}>
          Ask isn&apos;t set up yet. On the server, add <code className="rounded bg-surface-chip px-1">OLLAMA_URL</code> to{" "}
          <code className="rounded bg-surface-chip px-1">.env.docker</code> (the address of the PC running Ollama) and restart the app.
        </p>
      );
    case "unreachable":
      return (
        <div className="grid gap-2">
          <p className={step}>
            The model on your PC isn&apos;t answering (<code className="rounded bg-surface-chip px-1">{status.host}</code> · {status.reason}). Ask needs it running, so:
          </p>
          <ol className="grid list-decimal gap-1 pl-5 text-body text-ink-secondary">
            <li>Turn the PC on and wait for it to connect to your Tailscale network.</li>
            <li>Make sure Ollama is running (it sits in the system tray).</li>
            <li>Ollama must be allowed to listen on the network: <code className="rounded bg-surface-chip px-1">OLLAMA_HOST=0.0.0.0</code> and a firewall rule for port 11434.</li>
          </ol>
          <p className={step}>Then press &ldquo;Check again&rdquo;.</p>
        </div>
      );
    case "no-models":
      return (
        <p className={step}>
          Ollama is running on <code className="rounded bg-surface-chip px-1">{status.host}</code> but has no models installed. On the PC run{" "}
          <code className="rounded bg-surface-chip px-1">ollama pull qwen2.5-coder:14b</code>, then check again.
        </p>
      );
    case "model-missing":
      return (
        <p className={step}>
          Ollama is running but the model <code className="rounded bg-surface-chip px-1">{status.model}</code> isn&apos;t installed. Installed:{" "}
          {status.installed.join(", ")}. Run <code className="rounded bg-surface-chip px-1">ollama pull {status.model}</code> on the PC, or set{" "}
          <code className="rounded bg-surface-chip px-1">OLLAMA_MODEL</code> to one you have.
        </p>
      );
    case "ready":
      return null;
  }
}

function Suggestions({ label, items, onPick }: { label: string; items: string[]; onPick: (q: string) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="grid gap-1.5">
      <span className="text-caption font-medium text-ink-muted">{label}</span>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onPick(item)}
            className="rounded-pill border border-line px-3 py-1 text-left text-caption text-ink-secondary hover:bg-surface-chip"
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

function ResultCard({ answer, note, sql, table, currency }: { answer: string; note?: string | null; sql?: string | null; table: ResultTable | null; currency: string }) {
  return (
    <div className="grid gap-3 rounded-card border-l-4 border-highlight-strong bg-highlight p-4 shadow-sm">
      <p className="text-heading">{answer}</p>
      {note ? <p className="text-caption text-ink-muted">{note}</p> : null}
      {table && table.rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                {table.columns.map((c) => (
                  <th key={c} scope="col" className={isMoneyColumn(c) ? "text-right" : ""}>
                    {(isMoneyColumn(c) ? c.replace(/_cents$/i, "") : c).replace(/_/g, " ")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => {
                    const column = table.columns[j]!;
                    const money = isMoneyColumn(column) && typeof cell === "number";
                    return (
                      <td key={column} data-label={column.replace(/_cents$/i, "").replace(/_/g, " ")} className={money ? "text-right tabular-nums" : ""}>
                        {money ? formatCents(cell, currency) : cell === null ? "—" : String(cell)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {table.truncated ? <p className="mt-2 text-caption text-ink-muted">Showing the first {table.rows.length} rows.</p> : null}
        </div>
      ) : null}
      {sql ? (
        <details className="text-caption text-ink-muted">
          <summary className="cursor-pointer">How it was worked out</summary>
          <pre className="mt-2 overflow-x-auto rounded-chip bg-surface-sunken p-3 text-[12px] whitespace-pre-wrap">{sql}</pre>
        </details>
      ) : null}
    </div>
  );
}

export function AskBox({ currency }: { currency: string }) {
  const [status, setStatus] = useState<ModelStatus | "checking">("checking");
  const [waking, setWaking] = useState(false);
  const [wakeBusy, setWakeBusy] = useState(false);
  const [canShutdown, setCanShutdown] = useState(false);
  const [shutdown, setShutdown] = useState<ShutdownState>(null);
  const [wakeMessage, setWakeMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [history, setHistory] = useState<History>({ mine: [], shared: [] });
  const [open, setOpen] = useState<string | null>(null);

  // quiet = background poll: don't flip the badge back to "Checking…".
  const check = useCallback(async (quiet = false): Promise<StatusResponse> => {
    if (!quiet) setStatus("checking");
    let next: StatusResponse;
    try {
      const response = await fetch("/api/ask");
      next = response.ok ? ((await response.json()) as StatusResponse) : { state: "unreachable", host: "server", reason: `HTTP ${response.status}` };
    } catch {
      next = { state: "unreachable", host: "server", reason: "network error" };
    }
    setStatus(next);
    setCheckedAt(new Date());
    setCanShutdown(Boolean(next.canShutdown));
    // A page loaded mid-boot (or after a reload) resumes the waking view.
    if (next.state === "unreachable" && next.waking) setWaking(true);
    if (next.state !== "unreachable") setWaking(false);
    return next;
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const response = await fetch("/api/ask/history");
      if (response.ok) setHistory((await response.json()) as History);
    } catch {
      // History is a convenience; the box still works without it.
    }
  }, []);

  useEffect(() => {
    void check();
    void loadHistory();
  }, [check, loadHistory]);

  // Live status: keep re-checking while the tab is visible, and check straight away
  // when the user comes back to it. Skips a tick if the last request is still running.
  useEffect(() => {
    let inFlight = false;
    const tick = async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        await check(true);
      } finally {
        inFlight = false;
      }
    };
    const timer = setInterval(() => void tick(), LIVE_POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [check]);

  // After a wake signal the live poll above notices the PC coming up (check() clears
  // `waking`); this only gives up after 2 minutes.
  useEffect(() => {
    if (!waking) return;
    const timer = setTimeout(() => {
      setWaking(false);
      setWakeMessage("The computer didn't come online. Check that it is plugged in and Wake-on-LAN is enabled.");
    }, WAKE_GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, [waking]);

  async function checkAgain() {
    setNotice(null);
    setWakeMessage(null);
    const next = await check();
    if (next.state === "unreachable") setNotice(`Still offline (checked ${new Date().toLocaleTimeString()}).`);
  }

  async function startAi() {
    setWakeBusy(true);
    setWakeMessage(null);
    setNotice(null);
    const res = await sendJson("POST", "/api/ask/wake");
    setWakeBusy(false);
    if (!res.ok) {
      setWakeMessage(res.error);
      return;
    }
    if (status !== "checking" && status.state === "unreachable") setWaking(true);
    else setWakeMessage("Wake signal sent.");
  }

  function startShutdown() {
    setWakeMessage(null);
    setNotice(null);
    setShutdown({ phase: "pending", left: SHUTDOWN_GRACE_S });
  }

  function cancelShutdown() {
    setShutdown(null);
    setNotice("Shutdown cancelled.");
  }

  // One tick per second: the cancellable countdown runs out into the real
  // request, then the "powering off" countdown runs out into a status re-check.
  useEffect(() => {
    if (!shutdown || shutdown.phase === "sending") return;
    const timer = setTimeout(async () => {
      if (shutdown.left > 1) {
        setShutdown({ phase: shutdown.phase, left: shutdown.left - 1 });
        return;
      }
      if (shutdown.phase === "off") {
        setShutdown(null);
        setWakeMessage("The computer should be off now.");
        void check(true);
        return;
      }
      setShutdown({ phase: "sending", left: 0 });
      const res = await sendJson("POST", "/api/ask/shutdown");
      if (!res.ok) {
        setShutdown(null);
        setWakeMessage(res.error);
        return;
      }
      setShutdown({ phase: "off", left: SHUTDOWN_PC_DELAY_S });
    }, 1000);
    return () => clearTimeout(timer);
  }, [shutdown, check]);

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (busy || question.trim().length < 3) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await sendJson<AskResponse | { status: ModelStatus }>("POST", "/api/ask", { question });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      if (/lost contact|isn't answering|HTTP 503/i.test(res.error)) void check();
      void loadHistory();
      return;
    }
    if ("status" in res.data) {
      setStatus(res.data.status);
      return;
    }
    setResult(res.data);
    void loadHistory();
  }

  async function remove(id: string) {
    const res = await sendJson("DELETE", `/api/ask/history/${id}`);
    if (res.ok) {
      setHistory((h) => ({ ...h, mine: h.mine.filter((item) => item.id !== id) }));
      if (result?.id === id) setResult(null);
    }
  }

  const ready = status !== "checking" && status.state === "ready";
  // The PC counts as "on" whenever Ollama answers (even with a model problem); "unconfigured" has nothing to reach.
  const pcOn = status !== "checking" && status.state !== "unreachable" && status.state !== "unconfigured";
  const panelTone = status === "checking" ? "checking" : pcOn ? "on" : waking ? "waking" : "off";
  const pick = (q: string) => {
    setQuestion(q);
    setResult(null);
    setError(null);
  };

  return (
    <div>
      <section
        aria-label="AI computer"
        className={cn(
          "mb-4 grid gap-3 rounded-card border-2 p-4 shadow-sm transition-colors",
          panelTone === "on" && "border-success bg-success-tint",
          panelTone === "off" && "border-danger bg-danger-tint",
          panelTone === "waking" && "border-warning bg-warning-tint",
          panelTone === "checking" && "border-line bg-surface-sunken",
        )}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span
            aria-hidden
            className={cn(
              "h-3 w-3 shrink-0 rounded-full",
              panelTone === "on" && "bg-success",
              panelTone === "off" && "bg-danger",
              panelTone === "waking" && "animate-pulse bg-warning",
              panelTone === "checking" && "animate-pulse bg-ink-subtle",
            )}
          />
          <div className="grid min-w-0 flex-1 gap-0.5">
            <span className="text-heading font-semibold">
              {panelTone === "on" ? "AI computer is ON" : panelTone === "off" ? "AI computer is OFF" : panelTone === "waking" ? "Starting up…" : "Checking your PC…"}
            </span>
            <span className="text-caption text-ink-secondary">
              {status !== "checking" && status.state === "ready" ? `Ready · ${status.model}` : null}
              {checkedAt ? `${status !== "checking" && status.state === "ready" ? " · " : ""}live, last contact ${checkedAt.toLocaleTimeString()}` : null}
            </span>
          </div>
          {status !== "checking" && !pcOn && !waking && !shutdown ? (
            <Button className="bg-danger text-inverse hover:opacity-90" onClick={() => void startAi()} disabled={wakeBusy}>
              Start-Beeniara-Ai
            </Button>
          ) : null}
          {status !== "checking" && status.state !== "ready" && !waking ? (
            <Button variant="ghost" onClick={() => void checkAgain()}>
              Check again
            </Button>
          ) : null}
          {canShutdown && !shutdown && pcOn ? (
            <Button className="bg-success text-inverse hover:opacity-90" onClick={startShutdown}>
              Shut down PC
            </Button>
          ) : null}
        </div>

        {waking ? <p className="text-body text-ink-secondary">Wake signal sent. Waiting for the computer to start up, this can take a minute or two…</p> : null}
        {shutdown ? (
          <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-3 rounded-chip bg-surface px-3 py-2 text-body text-ink-secondary">
            {shutdown.phase === "pending" ? (
              <>
                <span>
                  Shutting down the PC in <strong className="tabular-nums">{shutdown.left}s</strong>. Anything else running on it (including other apps&apos; AI) will stop.
                </span>
                <Button variant="ghost" onClick={cancelShutdown}>
                  Cancel
                </Button>
              </>
            ) : shutdown.phase === "sending" ? (
              <span>Sending the shutdown command…</span>
            ) : (
              <span>
                Command sent. The PC switches off in <strong className="tabular-nums">{shutdown.left}s</strong>.
              </span>
            )}
          </div>
        ) : null}
        {wakeMessage ? <p className="text-caption text-ink-secondary">{wakeMessage}</p> : null}
        {notice && !wakeMessage ? <p className="text-caption text-ink-secondary">{notice}</p> : null}
      </section>

      {status !== "checking" && status.state !== "ready" && !waking ? <Guidance status={status} /> : null}

      {ready ? (
        <form onSubmit={submit} className="grid gap-3">
          <label className="grid gap-1 text-caption text-ink-muted">
            <span className="font-medium">Your question</span>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="e.g. How much have I spent at Uber Eats this year?"
              className="w-full rounded-chip border border-line bg-surface px-3 py-2 text-body text-ink placeholder:text-ink-subtle"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={busy || question.trim().length < 3}>
              {busy ? "Thinking…" : "Ask"}
            </Button>
            <span className="text-caption text-ink-muted">Runs on your PC; nothing leaves your own machines. Can take a little while.</span>
          </div>
          {!result && !busy ? (
            <div className="grid gap-3">
              <Suggestions label="Try one of these" items={EXAMPLES} onPick={pick} />
              <Suggestions label="Questions others have asked" items={history.shared} onPick={pick} />
            </div>
          ) : null}
        </form>
      ) : null}

      <div className="mt-3 grid gap-3">
        <FormError message={error} />
        {result ? <ResultCard answer={result.answer} note={result.note} sql={result.sql} table={result.table} currency={currency} /> : null}
      </div>

      {history.mine.length > 0 ? (
        <div className="mt-6">
          <h3 className="mb-2 text-body font-semibold">Your recent questions</h3>
          <ol className="divide-y divide-line">
            {history.mine.map((item) => {
              const expanded = open === item.id;
              return (
                <li key={item.id} className="py-3">
                  <div className="flex flex-col gap-2 rail:flex-row rail:items-start rail:gap-4">
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : item.id)}
                      aria-expanded={expanded}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block font-medium">{item.question}</span>
                      <span className="block text-caption text-ink-muted">
                        {formatDate(new Date(item.createdAt), "long")}
                        {item.error ? " · didn't work" : item.rowCount !== null ? ` · ${item.rowCount} row${item.rowCount === 1 ? "" : "s"}` : ""}
                        {item.durationMs ? ` · ${Math.round(item.durationMs / 1000)}s` : ""}
                        {expanded ? " · tap to hide" : " · tap to see the answer"}
                      </span>
                    </button>
                    <div className="flex shrink-0 gap-2">
                      {ready ? (
                        <Button variant="ghost" className="px-3 py-1.5 text-caption" onClick={() => pick(item.question)}>
                          Ask again
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        className="px-3 py-1.5 text-caption"
                        onClick={() => void remove(item.id)}
                        aria-label={`Delete "${item.question}"`}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                  {expanded ? (
                    <div className="mt-3">
                      {item.error ? (
                        <p className="rounded-chip bg-danger-tint px-3 py-2 text-caption text-danger">{item.error}</p>
                      ) : (
                        <ResultCard answer={item.answer ?? ""} note={item.note} sql={item.sql} table={null} currency={currency} />
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
