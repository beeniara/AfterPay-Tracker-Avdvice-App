import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { isWolConfigured, mayWake, recentlyWoken, resetWolState, sendWakePacket, takeWakeSlot } from "./wol";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "wol-"));
  vi.stubEnv("DATABASE_URL", "postgres://x:x@localhost:5432/x");
  vi.stubEnv("PC_MAC_ADDRESS", "02:00:00:00:00:01");
  vi.stubEnv("WOL_SPOOL_DIR", dir);
  vi.stubEnv("WAKE_ALLOWED_EMAILS", " Owner@Example.com ,second@example.com");
  vi.stubEnv("WAKE_WINDOW_SECONDS", "2");
  resetEnvCache();
  resetWolState();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  resetEnvCache();
  await rm(dir, { recursive: true, force: true });
});

describe("mayWake", () => {
  it("allows only listed emails, case-insensitively", () => {
    expect(mayWake("owner@example.com")).toBe(true);
    expect(mayWake("SECOND@example.com")).toBe(true);
    expect(mayWake("stranger@example.com")).toBe(false);
    expect(mayWake(null)).toBe(false);
  });

  it("allows nobody when the list is empty or waking isn't configured", () => {
    vi.stubEnv("WAKE_ALLOWED_EMAILS", "");
    resetEnvCache();
    expect(mayWake("owner@example.com")).toBe(false);

    vi.stubEnv("WAKE_ALLOWED_EMAILS", "owner@example.com");
    vi.stubEnv("PC_MAC_ADDRESS", "");
    resetEnvCache();
    expect(isWolConfigured()).toBe(false);
    expect(mayWake("owner@example.com")).toBe(false);
  });
});

describe("takeWakeSlot", () => {
  it("allows 3 per minute then blocks, and frees up after the window", () => {
    const t = 1_000_000;
    expect([1, 2, 3, 4].map(() => takeWakeSlot(t))).toEqual([true, true, true, false]);
    expect(takeWakeSlot(t + 61_000)).toBe(true);
  });
});

describe("sendWakePacket", () => {
  it("fails cleanly, without marking the PC as waking, when the sidecar is silent", async () => {
    const err = await sendWakePacket(400).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/did not answer/);
    expect(recentlyWoken()).toBe(false);
  });

  it("succeeds when the sidecar answers ok, then reports 'waking' only inside the window", async () => {
    const responder = setInterval(async () => {
      try {
        await readFile(path.join(dir, "wake.req"));
        await rm(path.join(dir, "wake.req"), { force: true });
        await writeFile(path.join(dir, "wake.res"), "ok");
      } catch {
        // no request yet
      }
    }, 50);
    try {
      await sendWakePacket();
    } finally {
      clearInterval(responder);
    }
    expect(recentlyWoken()).toBe(true);
    expect(recentlyWoken(Date.now() + 3_000)).toBe(false);
  });

  it("surfaces a sidecar error reply", async () => {
    const responder = setInterval(async () => {
      try {
        await readFile(path.join(dir, "wake.req"));
        await rm(path.join(dir, "wake.req"), { force: true });
        await writeFile(path.join(dir, "wake.res"), "error: boom");
      } catch {
        // no request yet
      }
    }, 50);
    try {
      await expect(sendWakePacket()).rejects.toThrow(/error: boom/);
    } finally {
      clearInterval(responder);
    }
    expect(recentlyWoken()).toBe(false);
  });
});
