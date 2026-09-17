import { NextResponse } from "next/server";
import { handleApiError, requireContext } from "@/lib/api/handler";
import { serializeSummary } from "@/lib/api/serialize";
import { summarize } from "@/lib/db/queries";

export async function GET() {
  try {
    const { db, user, today } = await requireContext();
    const summary = await summarize(db, user.id, user.currency, today);
    return NextResponse.json(serializeSummary(summary));
  } catch (error) {
    return handleApiError(error);
  }
}
