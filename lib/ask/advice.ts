import type { Db } from "@/lib/db";
import { loadAllOrders } from "@/lib/db/queries";
import { buildInsights, type InsightOrder } from "@/lib/insights";
import {
  ADVICE_NUM_CTX,
  AdviceParseError,
  adviceSystemPrompt,
  buildAdviceContext,
  parseAdvicePlan,
  plainFormatters,
  verifyPlanAmounts,
  type AdvicePlan,
} from "./advice-prompt";
import { chat, type ChatMessage, type ModelConfig } from "./ollama";

// One long call: the whole order digest goes in, one JSON plan comes out.
const ADVICE_TIMEOUT_MS = 180_000;
// The route allows 300 s; a repair round only starts if there is room for it.
const REPAIR_BUDGET_MS = 100_000;

export class NoActiveOrdersError extends Error {
  constructor() {
    super("Nothing to plan: there are no active orders.");
    this.name = "NoActiveOrdersError";
  }
}

export interface AdviseResult {
  plan: AdvicePlan;
  model: string;
  ordersShown: number;
  ordersTotal: number;
  promptTokensEstimate: number;
  // Amount chips the model gave that are not figures from the data; removed from the plan.
  droppedAmounts: number;
  durationMs: number;
}

// Takes the orders directly so it can be tested without a database.
export async function adviseFromOrders(
  config: Required<ModelConfig>,
  orders: readonly InsightOrder[],
  note: string | undefined,
  today: string,
  currency: string,
): Promise<AdviseResult> {
  const started = Date.now();
  const insights = buildInsights(orders, today, plainFormatters);
  const context = buildAdviceContext(orders, insights, today, currency, note);
  if (context.ordersTotal === 0) throw new NoActiveOrdersError();

  const messages: ChatMessage[] = [
    { role: "system", content: adviceSystemPrompt(today, currency) },
    { role: "user", content: context.text },
  ];
  const options = { json: true, numCtx: ADVICE_NUM_CTX, timeoutMs: ADVICE_TIMEOUT_MS };

  let reply = await chat(config.url, config.model, messages, options);
  let plan: AdvicePlan;
  try {
    plan = parseAdvicePlan(reply);
  } catch (error) {
    if (!(error instanceof AdviceParseError) || Date.now() - started > REPAIR_BUDGET_MS) throw error;
    messages.push(
      { role: "assistant", content: reply },
      {
        role: "user",
        content: `That was not valid: ${error.detail}. Reply with only the JSON object in the shape given.`,
      },
    );
    reply = await chat(config.url, config.model, messages, options);
    try {
      plan = parseAdvicePlan(reply);
    } catch (second) {
      // Kept for tuning the prompt; the person only sees the friendly message.
      console.warn("Advice reply was not usable:", reply.slice(0, 500));
      throw second;
    }
  }

  const verified = verifyPlanAmounts(plan, context.knownAmounts);
  return {
    plan: verified.plan,
    model: config.model,
    ordersShown: context.ordersShown,
    ordersTotal: context.ordersTotal,
    promptTokensEstimate: context.tokensEstimate,
    droppedAmounts: verified.dropped,
    durationMs: Date.now() - started,
  };
}

export async function advise(
  db: Db,
  config: Required<ModelConfig>,
  userId: string,
  note: string | undefined,
  today: string,
  currency: string,
): Promise<AdviseResult> {
  return adviseFromOrders(config, await loadAllOrders(db, userId, today), note, today, currency);
}
