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
const SHUTDOWN_REQ = "shutdown.req";
const SHUTDOWN_RES = "shutdown.res";
const SHUTDOWN_REPLY_TIMEOUT_MS = 20_000;

// globalThis so a hot-reloaded module doesn't forget a recent wake.
const state = globalThis as unknown as { __wolLastWakeAt?: number; __wolHits?: number[]; __shutdownHits?: number[] };

export function isWolConfigured(): boolean {
  return Boolean(getEnv().PC_MAC_ADDRESS);
}

export function mayWake(email: string | null | undefined): boolean {
  if (!isWolConfigured() || !email) return false;
  return getEnv().WAKE_ALLOWED_EMAILS.includes(email.trim().toLowerCase());
}

export function isShutdownConfigured(): boolean {
  return Boolean(getEnv().PC_SSH_HOST);
}

// Same allow-list as waking: whoever may turn the PC on may turn it off.
export function mayShutdown(email: string | null | undefined): boolean {
  if (!isShutdownConfigured() || !email) return false;
  return getEnv().WAKE_ALLOWED_EMAILS.includes(email.trim().toLowerCase());
}

export function recentlyWoken(now = Date.now()): boolean {
  const at = state.__wolLastWakeAt ?? 0;
  return at > 0 && now - at < getEnv().WAKE_WINDOW_SECONDS * 1000;
}

// Small fixed-window limiter (one process, one PC): true = allowed.
function takeSlot(key: "__wolHits" | "__shutdownHits", now: number): boolean {
  const hits = (state[key] ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  const allowed = hits.length < RATE_MAX;
  if (allowed) hits.push(now);
  state[key] = hits;
  return allowed;
}

export const takeWakeSlot = (now = Date.now()) => takeSlot("__wolHits", now);
export const takeShutdownSlot = (now = Date.now()) => takeSlot("__shutdownHits", now);

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

// Drops <name>.req in the spool folder and waits for the sidecar's <name>.res.
async function spoolRequest(reqName: string, resName: string, what: string, replyTimeoutMs: number): Promise<void> {
  const dir = getEnv().WOL_SPOOL_DIR;
  const req = path.join(dir, reqName);
  const res = path.join(dir, resName);

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
    return;
  }
  await rm(req, { force: true });
  throw new Error(`wol sidecar did not answer the ${what} request (is the wol service running?)`);
}

export async function sendWakePacket(replyTimeoutMs = DEFAULT_REPLY_TIMEOUT_MS): Promise<void> {
  await spoolRequest(REQ, RES, "wake", replyTimeoutMs);
  state.__wolLastWakeAt = Date.now();
}

// Asks the sidecar to SSH into the PC and run its one allowed command (shutdown).
export async function sendShutdown(replyTimeoutMs = SHUTDOWN_REPLY_TIMEOUT_MS): Promise<void> {
  await spoolRequest(SHUTDOWN_REQ, SHUTDOWN_RES, "shutdown", replyTimeoutMs);
  // It is going down, so it is no longer "waking".
  state.__wolLastWakeAt = undefined;
}

export function resetWolState(): void {
  state.__wolLastWakeAt = undefined;
  state.__wolHits = undefined;
  state.__shutdownHits = undefined;
}
