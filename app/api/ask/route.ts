import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleApiError, jsonError, parseBody, readJson, requireContext } from "@/lib/api/handler";
import { UnsafeSqlError } from "@/lib/ask/guard";
import { modelStatus, ModelUnreachableError } from "@/lib/ask/ollama";
import { ask } from "@/lib/ask/run";
import { isWolConfigured, mayWake, prepareSpool, recentlyWoken } from "@/lib/ask/wol";
import { recordAsk } from "@/lib/db/ask-history";
import { getEnv } from "@/lib/env";

export const maxDuration = 300;

const askSchema = z.object({
  question: z.string().trim().min(3, "Ask a question first").max(500, "Keep the question under 500 characters"),
});

function config() {
  const env = getEnv();
  return { url: env.OLLAMA_URL, model: env.OLLAMA_MODEL };
}

// Turns a failure from the model or the database into the message the user sees.
function describeFailure(error: unknown): { status: number; message: string } | null {
  if (error instanceof ModelUnreachableError) return { status: 503, message: error.message };
  if (error instanceof UnsafeSqlError) {
    return { status: 422, message: `The model wrote a query the app refused to run (${error.message.toLowerCase()}). Try rephrasing.` };
  }
  if (error instanceof Error && /usable query/.test(error.message)) {
    return { status: 422, message: "The model couldn't turn that into a query. Try rephrasing." };
  }
  // Drizzle wraps driver errors; the Postgres error (with its SQLSTATE) is the cause.
  const dbError = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  const code = dbError instanceof Error && "code" in dbError && typeof dbError.code === "string" ? dbError.code : "";
  if (code === "57014") return { status: 422, message: "That question took too long to answer. Try something narrower." };
  if (code.startsWith("42") && dbError instanceof Error) {
    return { status: 422, message: `The model wrote a query that doesn't run (${dbError.message}). Try rephrasing.` };
  }
  return null;
}

// The model status (unchanged shape) plus wake info: canWake = this account may
// press Start-Beeniara-Ai; waking = the PC is unreachable but a wake signal went
// out recently, so it is probably still booting.
export async function GET() {
  try {
    const { user } = await requireContext();
    if (isWolConfigured()) prepareSpool();
    const status = await modelStatus(config());
    return NextResponse.json({
      ...status,
      canWake: mayWake(user.email),
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
    const status = await modelStatus(config());
    if (status.state !== "ready") return NextResponse.json({ status }, { status: 503 });

    const started = Date.now();
    try {
      const result = await ask(db, { url: config().url!, model: status.model }, user.id, question, today, user.currency);
      const saved = await recordAsk(db, user.id, {
        question,
        answer: result.answer,
        sql: result.sql || null,
        note: result.note || null,
        model: status.model,
        rowCount: result.table?.rows.length ?? null,
        error: null,
        durationMs: Date.now() - started,
      });
      return NextResponse.json({ ...result, model: status.model, id: saved.id });
    } catch (error) {
      const failure = describeFailure(error);
      if (!failure) throw error;
      if (failure.status === 422) {
        await recordAsk(db, user.id, {
          question,
          answer: null,
          sql: null,
          note: null,
          model: status.model,
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
