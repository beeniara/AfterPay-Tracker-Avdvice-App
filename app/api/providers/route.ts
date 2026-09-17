import { NextResponse, type NextRequest } from "next/server";
import {
  handleApiError,
  parseBody,
  readJson,
  requireContext,
  revalidateMoneyPaths,
} from "@/lib/api/handler";
import { providerSchema } from "@/lib/api/schemas";
import { createProvider } from "@/lib/db/mutations";
import { listProviders } from "@/lib/db/queries";

export async function GET() {
  try {
    const { db, user } = await requireContext();
    return NextResponse.json({ results: await listProviders(db, user.id) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { db, user } = await requireContext();
    const input = parseBody(providerSchema, await readJson(request));
    const provider = await createProvider(db, user.id, input);
    revalidateMoneyPaths();
    return NextResponse.json(provider, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
