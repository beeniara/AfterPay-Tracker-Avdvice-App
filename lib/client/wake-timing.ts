// How long Assistance Beeniara takes to come up after a wake signal, remembered in this
// browser (localStorage) so each start can be compared with the one before.

const KEY = "ask-wake-times";
const KEEP = 5;
// A wake older than this is a page left open overnight, not a measurement.
const MAX_PENDING_MS = 5 * 60 * 1000;
export const DEFAULT_ESTIMATE_S = 45;

interface Stored {
  pendingStart: number | null;
  history: number[];
}

function load(): Stored {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Stored>) : {};
    return {
      pendingStart: typeof parsed.pendingStart === "number" ? parsed.pendingStart : null,
      history: Array.isArray(parsed.history) ? parsed.history.filter((n): n is number => typeof n === "number" && n > 0).slice(-KEEP) : [],
    };
  } catch {
    return { pendingStart: null, history: [] };
  }
}

function save(stored: Stored): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Blocked storage: the timing just isn't remembered.
  }
}

export function startWakeTimer(now: number): void {
  save({ ...load(), pendingStart: now });
}

export function clearWakeTimer(): void {
  save({ ...load(), pendingStart: null });
}

// The start time of a wake still in progress (survives a page reload), or null.
export function pendingWakeStart(now: number): number | null {
  const { pendingStart } = load();
  return pendingStart !== null && now - pendingStart <= MAX_PENDING_MS ? pendingStart : null;
}

// Seconds the last recorded start took, or null if there is none yet.
export function lastWakeSeconds(): number | null {
  return load().history.at(-1) ?? null;
}

// Ends the running timer: records the duration and returns it with the previous one.
export function finishWakeTimer(now: number): { seconds: number; previous: number | null } | null {
  const stored = load();
  const start = stored.pendingStart;
  if (start === null || now - start > MAX_PENDING_MS) {
    save({ ...stored, pendingStart: null });
    return null;
  }
  const seconds = Math.max(1, Math.round((now - start) / 1000));
  save({ pendingStart: null, history: [...stored.history, seconds].slice(-KEEP) });
  return { seconds, previous: stored.history.at(-1) ?? null };
}

function plural(n: number): string {
  return `${n} second${n === 1 ? "" : "s"}`;
}

// The sentence said and shown after a start, e.g.
// "It took 32 seconds to start, 18 seconds quicker than last time. Much quicker!"
export function describeWake(seconds: number, previous: number | null): string {
  const took = `It took ${plural(seconds)} to start`;
  if (previous === null) return `${took}. That is the first start I have timed, so next time I can compare.`;
  const diff = previous - seconds;
  const ratio = Math.abs(diff) / previous;
  if (Math.abs(diff) < 3 || ratio < 0.1) return `${took}, about the same as last time (${plural(previous)}).`;
  if (diff > 0) {
    return `${took}, ${plural(diff)} quicker than last time. ${ratio >= 0.25 ? "Much quicker!" : "A little quicker."}`;
  }
  return `${took}, ${plural(-diff)} slower than last time. ${ratio >= 0.25 ? "Much slower, the PC may be busy." : "A little slower."}`;
}
