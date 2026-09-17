import { NextResponse } from "next/server";
import { handleApiError, requireContext } from "@/lib/api/handler";
import { listAskHistory, listSharedQuestions } from "@/lib/db/ask-history";

export async function GET() {
  try {
    const { db, user } = await requireContext();
    const [mine, shared] = await Promise.all([listAskHistory(db, user.id), listSharedQuestions(db, user.id)]);
    return NextResponse.json({
      mine: mine.map((r) => ({
        id: r.id,
        question: r.question,
        answer: r.answer,
        sql: r.sql,
        note: r.note,
        model: r.model,
        rowCount: r.rowCount,
        error: r.error,
        durationMs: r.durationMs,
        createdAt: r.createdAt.toISOString(),
      })),
      shared,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
