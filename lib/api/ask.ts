import { NextResponse } from "next/server";
import { NoActiveOrdersError } from "@/lib/ask/advice";
import { AdviceParseError } from "@/lib/ask/advice-prompt";
import { UnsafeSqlError } from "@/lib/ask/guard";
import { chooseModel, modelStatus, ModelUnreachableError, type ModelConfig } from "@/lib/ask/ollama";
import { getEnv } from "@/lib/env";

// Shared by the Ask and advice routes: which model to talk to, whether it is
// ready, and how a failure from the model or the database reads to the person.

export function ollamaConfig(): ModelConfig {
  const env = getEnv();
  return { url: env.OLLAMA_URL, model: env.OLLAMA_MODEL };
}

export type ReadyModel = { ready: true; url: string; model: string } | { ready: false; response: NextResponse };

// When the model isn't ready, `response` is the 503 { status } the Ask box already understands.
// `preferred` names a different installed model for this task (used if it is there).
export async function requireReadyModel(preferred?: string): Promise<ReadyModel> {
  const config = ollamaConfig();
  const status = await modelStatus(config);
  if (status.state !== "ready") return { ready: false, response: NextResponse.json({ status }, { status: 503 }) };
  return { ready: true, url: config.url!, model: chooseModel(status.installed, status.model, preferred) };
}

// Turns a failure from the model or the database into the message the user sees.
export function describeAskFailure(error: unknown): { status: number; message: string } | null {
  if (error instanceof ModelUnreachableError) return { status: 503, message: error.message };
  if (error instanceof UnsafeSqlError) {
    return { status: 422, message: `The model wrote a query the app refused to run (${error.message.toLowerCase()}). Try rephrasing.` };
  }
  if (error instanceof Error && /usable query/.test(error.message)) {
    return { status: 422, message: "The model couldn't turn that into a query. Try rephrasing." };
  }
  if (error instanceof AdviceParseError) {
    return {
      status: 422,
      message: "Assistance Beeniara couldn't put a plan together this time. Try again, or add a line of context.",
    };
  }
  if (error instanceof NoActiveOrdersError) return { status: 422, message: error.message };
  // Drizzle wraps driver errors; the Postgres error (with its SQLSTATE) is the cause.
  const dbError = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  const code = dbError instanceof Error && "code" in dbError && typeof dbError.code === "string" ? dbError.code : "";
  if (code === "57014") return { status: 422, message: "That question took too long to answer. Try something narrower." };
  if (code.startsWith("42") && dbError instanceof Error) {
    return { status: 422, message: `The model wrote a query that doesn't run (${dbError.message}). Try rephrasing.` };
  }
  return null;
}
