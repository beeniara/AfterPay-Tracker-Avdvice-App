import { chmodSync, existsSync } from "node:fs";
import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/lib/env";

// The app runs on a Docker bridge network, where a UDP broadcast never reaches
// the LAN. So it hands the job to the "wol" sidecar (network_mode: host) through
// a shared spool folder: we create wake.req, the sidecar sends the magic packet
// and answers in wake.res. No network port is involved, and the sidecar decides
// the MAC, so this can only ever wake the one configured PC.
const REQ = "wake.req";
const RES = "wake.res";
const DEFAULT_REPLY_TIMEOUT_MS = 5_000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 3;

// globalThis so a hot-reloaded module doesn't forget a recent wake.
const state = globalThis as unknown as { __wolLastWakeAt?: number; __wolHits?: number[] };

export function isWolConfigured(): boolean {
  return Boolean(getEnv().PC_MAC_ADDRESS);
}

export function mayWake(email: string | null | undefined): boolean {
  if (!isWolConfigured() || !email) return false;
  return getEnv().WAKE_ALLOWED_EMAILS.includes(email.trim().toLowerCase());
}

export function recentlyWoken(now = Date.now()): boolean {
  const at = state.__wolLastWakeAt ?? 0;
  return at > 0 && now - at < getEnv().WAKE_WINDOW_SECONDS * 1000;
}

// Small fixed-window limiter (one process, one PC): true = allowed.
export function takeWakeSlot(now = Date.now()): boolean {
  const hits = (state.__wolHits ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) {
    state.__wolHits = hits;
    return false;
  }
  hits.push(now);
  state.__wolHits = hits;
  return true;
}

// The spool volume is created root-owned; the Dockerfile opens it at start, and
// this is the fallback if the app is started some other way.
export function prepareSpool(): void {
  const dir = getEnv().WOL_SPOOL_DIR;
  try {
    if (existsSync(dir)) chmodSync(dir, 0o777);
  } catch {
    // Not fatal: sending will report the real error.
  }
}

export async function sendWakePacket(replyTimeoutMs = DEFAULT_REPLY_TIMEOUT_MS): Promise<void> {
  const dir = getEnv().WOL_SPOOL_DIR;
  const req = path.join(dir, REQ);
  const res = path.join(dir, RES);

  await chmod(dir, 0o777);
  await rm(res, { force: true });
  await writeFile(req, String(Date.now()), { mode: 0o666 });
  await chmod(req, 0o666);

  const deadline = Date.now() + replyTimeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 150));
    let reply: string;
    try {
      reply = (await readFile(res, "utf8")).trim();
    } catch {
      continue;
    }
    await rm(res, { force: true });
    if (reply !== "ok") throw new Error(`wol sidecar: ${reply}`);
    state.__wolLastWakeAt = Date.now();
    return;
  }
  await rm(req, { force: true });
  throw new Error("wol sidecar did not answer (is the wol service running?)");
}

export function resetWolState(): void {
  state.__wolLastWakeAt = undefined;
  state.__wolHits = undefined;
}
