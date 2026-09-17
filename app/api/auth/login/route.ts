import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { handleApiError, jsonError, parseBody, readJson } from "@/lib/api/handler";
import { loginSchema } from "@/lib/api/schemas";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";

export async function POST(request: NextRequest) {
  try {
    const { email, password } = parseBody(loginSchema, await readJson(request));
    const db = getDb();
    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    const ok = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : false;
    if (!user || !ok) return jsonError(401, "Incorrect email or password");

    const { token, expiresAt } = await createSession(db, user.id, request.headers.get("user-agent"));
    await setSessionCookie(token, expiresAt);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
