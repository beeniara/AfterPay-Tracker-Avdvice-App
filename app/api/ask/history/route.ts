import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleApiError, jsonError, requireContext } from "@/lib/api/handler";
import { parseStoredPlan } from "@/lib/ask/advice-prompt";
import { listAskHistory, listSharedQuestions } from "@/lib/db/ask-history";

const kindSchema = z.enum(["question", "advice"]);

// ?kind=question|advice narrows the list; without it every kind comes back.
// Advice rows carry their plan parsed (null if the stored JSON can't be read).
export async function GET(request: NextRequest) {
  try {
    const { db, user } = await requireContext();
    const rawKind = request.nextUrl.searchParams.get("kind");
    const kind = rawKind === null ? { success: true as const, data: undefined } : kindSchema.safeParse(rawKind);
    if (!kind.success) return jsonError(400, "kind must be 'question' or 'advice'");

    const [mine, shared] = await Promise.all([
      listAskHistory(db, user.id, 20, kind.data),
      kind.data === "advice" ? Promise.resolve([]) : listSharedQuestions(db, user.id),
    ]);
    return NextResponse.json({
      mine: mine.map((r) => ({
        id: r.id,
        kind: r.kind,
        question: r.question,
        answer: r.answer,
        plan: r.kind === "advice" ? parseStoredPlan(r.answer) : null,
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
