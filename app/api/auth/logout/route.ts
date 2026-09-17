import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/handler";
import { clearSessionCookie, readSessionToken, revokeSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export async function POST() {
  try {
    const token = await readSessionToken();
    if (token) await revokeSession(getDb(), token);
    await clearSessionCookie();
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
