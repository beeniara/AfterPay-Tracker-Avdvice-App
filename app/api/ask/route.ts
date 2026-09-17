import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleApiError, jsonError, parseBody, readJson, requireContext } from "@/lib/api/handler";
import { UnsafeSqlError } from "@/lib/ask/guard";
import { modelStatus, ModelUnreachableError } from "@/lib/ask/ollama";
import { ask } from "@/lib/ask/run";
import { getEnv } from "@/lib/env";

export const maxDuration = 300;

const askSchema = z.object({
  question: z.string().trim().min(3, "Ask a question first").max(500, "Keep the question under 500 characters"),
});

function config() {
  const env = getEnv();
  return { url: env.OLLAMA_URL, model: env.OLLAMA_MODEL };
}

export async function GET() {
  try {
    await requireContext();
    return NextResponse.json(await modelStatus(config()));
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

    const result = await ask(db, { url: config().url!, model: status.model }, user.id, question, today, user.currency);
    return NextResponse.json({ ...result, model: status.model });
  } catch (error) {
    if (error instanceof ModelUnreachableError) return jsonError(503, error.message);
    if (error instanceof UnsafeSqlError) return jsonError(422, `The model wrote a query the app refused to run (${error.message.toLowerCase()}). Try rephrasing.`);
    if (error instanceof Error && /usable query/.test(error.message)) return jsonError(422, "The model couldn't turn that into a query. Try rephrasing.");
    // Drizzle wraps driver errors; the Postgres error (with its SQLSTATE) is the cause.
    const dbError = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    const code = dbError instanceof Error && "code" in dbError && typeof dbError.code === "string" ? dbError.code : "";
    if (code === "57014") return jsonError(422, "That question took too long to answer. Try something narrower.");
    if (code.startsWith("42") && dbError instanceof Error) {
      return jsonError(422, `The model wrote a query that doesn't run (${dbError.message}). Try rephrasing.`);
    }
    return handleApiError(error);
  }
}
