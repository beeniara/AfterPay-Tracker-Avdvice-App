import { NextResponse, type NextRequest } from "next/server";
import { handleApiError } from "@/lib/api/handler";
import { authenticationOptions, relyingParty } from "@/lib/auth/passkeys";

export async function POST(request: NextRequest) {
  try {
    const { rpID } = relyingParty(request);
    return NextResponse.json(await authenticationOptions(rpID));
  } catch (error) {
    return handleApiError(error);
  }
}
