import { NextResponse, type NextRequest } from "next/server";
import {
  handleApiError,
  parseBody,
  readJson,
  requireContext,
  revalidateMoneyPaths,
} from "@/lib/api/handler";
import { providerSchema } from "@/lib/api/schemas";
import { deleteProvider, updateProvider } from "@/lib/db/mutations";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { db, user } = await requireContext();
    const input = parseBody(providerSchema.partial(), await readJson(request));
    const provider = await updateProvider(db, user.id, id, input);
    revalidateMoneyPaths();
    return NextResponse.json(provider);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { db, user } = await requireContext();
    await deleteProvider(db, user.id, id);
    revalidateMoneyPaths();
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
