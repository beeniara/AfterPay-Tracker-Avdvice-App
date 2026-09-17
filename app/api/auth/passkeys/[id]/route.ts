import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { handleApiError, jsonError, requireContext } from "@/lib/api/handler";
import { passkeys } from "@/lib/db/schema";

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { db, user } = await requireContext();
    const deleted = await db
      .delete(passkeys)
      .where(and(eq(passkeys.id, id), eq(passkeys.userId, user.id)))
      .returning({ id: passkeys.id });
    if (deleted.length === 0) return jsonError(404, "Passkey not found");
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
