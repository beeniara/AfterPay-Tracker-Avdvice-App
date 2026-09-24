import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleApiError, jsonError, parseBody, readJson, requireContext } from "@/lib/api/handler";
import { describeAskFailure, ollamaConfig, requireReadyModel } from "@/lib/api/ask";
import { modelStatus } from "@/lib/ask/ollama";
import { ask } from "@/lib/ask/run";
import { isWolConfigured, mayShutdown, mayWake, prepareSpool, recentlyWoken } from "@/lib/ask/wol";
import { recordAsk } from "@/lib/db/ask-history";

export const maxDuration = 300;

const askSchema = z.object({
  question: z.string().trim().min(3, "Ask a question first").max(500, "Keep the question under 500 characters"),
});

// The model status (unchanged shape) plus wake info: canWake = this account may
// press Start-Beeniara-Ai; waking = the PC is unreachable but a wake signal went
// out recently, so it is probably still booting.
export async function GET() {
  try {
    const { user } = await requireContext();
    if (isWolConfigured()) prepareSpool();
    const status = await modelStatus(ollamaConfig());
    return NextResponse.json({
      ...status,
      canWake: mayWake(user.email),
      canShutdown: mayShutdown(user.email),
      waking: status.state === "unreachable" && recentlyWoken(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { db, user, today } = await requireContext();
    const { question } = parseBody(askSchema, await readJson(request));
    const model = await requireReadyModel();
    if (!model.ready) return model.response;

    const started = Date.now();
    try {
      const result = await ask(db, { url: model.url, model: model.model }, user.id, question, today, user.currency);
      const saved = await recordAsk(db, user.id, {
        question,
        answer: result.answer,
        sql: result.sql || null,
        note: result.note || null,
        model: model.model,
        rowCount: result.table?.rows.length ?? null,
        error: null,
        durationMs: Date.now() - started,
      });
      return NextResponse.json({ ...result, model: model.model, id: saved.id });
    } catch (error) {
      const failure = describeAskFailure(error);
      if (!failure) throw error;
      if (failure.status === 422) {
        await recordAsk(db, user.id, {
          question,
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
