import { NextResponse, type NextRequest } from "next/server";
import { handleApiError, requireContext } from "@/lib/api/handler";
import { registrationOptions, relyingParty } from "@/lib/auth/passkeys";

export async function POST(request: NextRequest) {
  try {
    const { db, user } = await requireContext();
    const { rpID } = relyingParty(request);
    return NextResponse.json(await registrationOptions(db, user, rpID));
  } catch (error) {
    return handleApiError(error);
  }
}
