import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleApiError, jsonError, parseBody, readJson, requireContext } from "@/lib/api/handler";
import { describeAskFailure, requireReadyModel } from "@/lib/api/ask";
import { advise, NoActiveOrdersError } from "@/lib/ask/advice";
import { MAX_CONTEXT_CHARS } from "@/lib/ask/advice-prompt";
import { recordAsk } from "@/lib/db/ask-history";
import { getEnv } from "@/lib/env";

// One long model call over every active order: allow well past the chat timeout.
export const maxDuration = 300;

const adviceSchema = z.object({
  context: z.string().trim().max(MAX_CONTEXT_CHARS, `Keep the note under ${MAX_CONTEXT_CHARS} characters`).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const { db, user, today } = await requireContext();
    const { context } = parseBody(adviceSchema, await readJson(request));
    const model = await requireReadyModel(getEnv().OLLAMA_ADVICE_MODEL);
    if (!model.ready) return model.response;

    const note = context || undefined;
    const started = Date.now();
    try {
      const result = await advise(db, { url: model.url, model: model.model }, user.id, note, today, user.currency);
      const saved = await recordAsk(db, user.id, {
        kind: "advice",
        question: note ?? "",
        answer: JSON.stringify(result.plan),
        sql: null,
        note: `${result.ordersShown} of ${result.ordersTotal} active orders shown`,
        model: result.model,
        rowCount: null,
        error: null,
        durationMs: result.durationMs,
      });
      return NextResponse.json({
        id: saved.id,
        kind: "advice",
        plan: result.plan,
        model: result.model,
        ordersShown: result.ordersShown,
        ordersTotal: result.ordersTotal,
        durationMs: result.durationMs,
      });
    } catch (error) {
      const failure = describeAskFailure(error);
      if (!failure) throw error;
      // A failed attempt is worth keeping (like a failed question); "nothing to plan" is not.
      if (failure.status === 422 && !(error instanceof NoActiveOrdersError)) {
        await recordAsk(db, user.id, {
          kind: "advice",
          question: note ?? "",
          answer: null,
          sql: null,
          note: null,
          model: model.model,
          rowCount: null,
          error: failure.message,
          durationMs: Date.now() - started,
        });
      }
      return jsonError(failure.status, failure.message);
    }
  } catch (error) {
    return handleApiError(error);
  }
}
