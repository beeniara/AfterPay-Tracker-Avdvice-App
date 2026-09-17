import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import type { DbClient } from "@/lib/db";
import { sessions, users, type User } from "@/lib/db/schema";
import { SESSION_COOKIE } from "./constants";

const SESSION_DAYS = 30;
const TOUCH_AFTER_MS = 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  db: DbClient,
  userId: string,
  userAgent?: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt, userAgent: userAgent ?? null });
  // Opportunistic cleanup so the table doesn't grow forever.
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  return { token, expiresAt };
}

export async function findSessionUser(db: DbClient, token: string): Promise<User | null> {
  const row = await db.query.sessions.findFirst({
    where: and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())),
    with: { user: true },
  });
  if (!row) return null;
  if (Date.now() - row.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.id));
  }
  return row.user;
}

export async function revokeSession(db: DbClient, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function revokeOtherSessions(db: DbClient, userId: string, keepToken: string): Promise<void> {
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), sql`${sessions.tokenHash} <> ${hashToken(keepToken)}`));
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function readSessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export async function currentUser(db: DbClient): Promise<User | null> {
  const token = await readSessionToken();
  return token ? findSessionUser(db, token) : null;
}

// First run: nobody can sign in yet, so /setup may claim the account.
export async function needsSetup(db: DbClient): Promise<boolean> {
  const [withPassword, withPasskey] = await Promise.all([
    db.query.users.findFirst({ where: sql`${users.passwordHash} is not null`, columns: { id: true } }),
    db.query.passkeys.findFirst({ columns: { id: true } }),
  ]);
  return !withPassword && !withPasskey;
}
