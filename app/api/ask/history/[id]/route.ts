import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleApiError, jsonError, requireContext } from "@/lib/api/handler";
import { deleteAsk } from "@/lib/db/ask-history";

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, user } = await requireContext();
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return jsonError(400, "Invalid id");
    if (!(await deleteAsk(db, user.id, id))) return jsonError(404, "Not found");
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
