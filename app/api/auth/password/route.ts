import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { handleApiError, jsonError, parseBody, readJson, requireContext } from "@/lib/api/handler";
import { passwordChangeSchema } from "@/lib/api/schemas";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { readSessionToken, revokeOtherSessions } from "@/lib/auth/session";
import { users } from "@/lib/db/schema";

export async function POST(request: NextRequest) {
  try {
    const { db, user } = await requireContext();
    const input = parseBody(passwordChangeSchema, await readJson(request));
    if (user.passwordHash) {
      const ok = input.currentPassword ? await verifyPassword(input.currentPassword, user.passwordHash) : false;
      if (!ok) return jsonError(400, "Current password is incorrect");
    }
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(input.newPassword) })
      .where(eq(users.id, user.id));
    const token = await readSessionToken();
    if (token) await revokeOtherSessions(db, user.id, token);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
