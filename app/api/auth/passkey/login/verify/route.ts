import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { NextResponse, type NextRequest } from "next/server";
import { jsonError, readJson } from "@/lib/api/handler";
import { completeAuthentication, relyingParty } from "@/lib/auth/passkeys";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export async function POST(request: NextRequest) {
  const body = (await readJson(request)) as AuthenticationResponseJSON | null;
  if (!body?.id) return jsonError(400, "Missing passkey response");
  try {
    const db = getDb();
    const userId = await completeAuthentication(db, body, relyingParty(request));
    const { token, expiresAt } = await createSession(db, userId, request.headers.get("user-agent"));
    await setSessionCookie(token, expiresAt);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(401, error instanceof Error ? error.message : "Passkey sign-in failed");
  }
}
