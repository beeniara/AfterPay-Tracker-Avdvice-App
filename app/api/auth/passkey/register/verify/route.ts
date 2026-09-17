import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { NextResponse, type NextRequest } from "next/server";
import { handleApiError, jsonError, readJson, requireContext } from "@/lib/api/handler";
import { passkeyNameSchema } from "@/lib/api/schemas";
import { completeRegistration, relyingParty } from "@/lib/auth/passkeys";

export async function POST(request: NextRequest) {
  try {
    const { db, user } = await requireContext();
    const body = (await readJson(request)) as { response?: RegistrationResponseJSON; name?: unknown } | null;
    if (!body?.response) return jsonError(400, "Missing passkey response");
    const { name } = passkeyNameSchema.parse({ name: body.name ?? "" });
    const passkey = await completeRegistration(db, user, body.response, name ?? null, relyingParty(request));
    return NextResponse.json({ id: passkey.id, name: passkey.name, createdAt: passkey.createdAt }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && !("status" in error)) return jsonError(400, error.message);
    return handleApiError(error);
  }
}
