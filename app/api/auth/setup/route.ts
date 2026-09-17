import { asc, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { handleApiError, jsonError, parseBody, readJson } from "@/lib/api/handler";
import { setupSchema } from "@/lib/api/schemas";
import { hashPassword } from "@/lib/auth/password";
import { createSession, needsSetup, setSessionCookie } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";

// Claims the account on first run: adopts an existing password-less user
// (e.g. one created by the CSV importer) or creates the first one.
export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    if (!(await needsSetup(db))) return jsonError(409, "An account already exists — sign in instead");
    const input = parseBody(setupSchema, await readJson(request));
    const passwordHash = await hashPassword(input.password);

    const existing = await db.query.users.findFirst({ orderBy: [asc(users.createdAt)] });
    let userId: string;
    if (existing) {
      await db
        .update(users)
        .set({ email: input.email, name: input.name ?? existing.name, passwordHash })
        .where(eq(users.id, existing.id));
      userId = existing.id;
    } else {
      const [created] = await db
        .insert(users)
        .values({ email: input.email, name: input.name ?? null, passwordHash })
        .returning({ id: users.id });
      userId = created!.id;
    }

    const { token, expiresAt } = await createSession(db, userId, request.headers.get("user-agent"));
    await setSessionCookie(token, expiresAt);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
