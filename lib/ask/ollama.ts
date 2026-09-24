const STATUS_TIMEOUT_MS = 3_000;
const CHAT_TIMEOUT_MS = 120_000;

export type ModelStatus =
  | { state: "unconfigured" }
  | { state: "unreachable"; host: string; reason: string }
  | { state: "no-models"; host: string }
  | { state: "model-missing"; host: string; model: string; installed: string[] }
  | { state: "ready"; host: string; model: string; installed: string[] };

export class ModelUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelUnreachableError";
  }
}

export interface ModelConfig {
  url?: string;
  model?: string;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function classifyStatus(
  config: ModelConfig,
  tags: { ok: true; models: string[] } | { ok: false; reason: string },
): ModelStatus {
  if (!config.url) return { state: "unconfigured" };
  const host = hostOf(config.url);
  if (!tags.ok) return { state: "unreachable", host, reason: tags.reason };
  if (tags.models.length === 0) return { state: "no-models", host };
  if (config.model && !tags.models.includes(config.model)) {
    return { state: "model-missing", host, model: config.model, installed: tags.models };
  }
  return { state: "ready", host, model: config.model ?? tags.models[0]!, installed: tags.models };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function describeFailure(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "timed out";
  const cause = error instanceof Error && "cause" in error ? (error.cause as { code?: string } | undefined) : undefined;
  if (cause?.code) return cause.code;
  return error instanceof Error ? error.message : "connection failed";
}

export async function listModels(url: string): Promise<{ ok: true; models: string[] } | { ok: false; reason: string }> {
  try {
    const response = await fetchWithTimeout(`${url.replace(/\/$/, "")}/api/tags`, { method: "GET" }, STATUS_TIMEOUT_MS);
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
    const data = (await response.json()) as { models?: { name?: string }[] };
    const models = (data.models ?? []).map((m) => m.name).filter((n): n is string => typeof n === "string");
    return { ok: true, models };
  } catch (error) {
    return { ok: false, reason: describeFailure(error) };
  }
}

// The model a task should run on: the preferred one if it is installed, otherwise
// the one the status already settled on. Never names a model that isn't there.
export function chooseModel(installed: readonly string[], fallback: string, preferred?: string): string {
  return preferred && installed.includes(preferred) ? preferred : fallback;
}

export async function modelStatus(config: ModelConfig): Promise<ModelStatus> {
  if (!config.url) return { state: "unconfigured" };
  return classifyStatus(config, await listModels(config.url));
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function chat(
  url: string,
  model: string,
  messages: ChatMessage[],
  // numCtx: Ollama's default context is small and silently drops the start of a
  // long prompt, so callers sending a lot of data must ask for more.
  options: { json?: boolean; numCtx?: number; timeoutMs?: number } = {},
): Promise<string> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${url.replace(/\/$/, "")}/api/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          ...(options.json ? { format: "json" } : {}),
          options: { temperature: 0, ...(options.numCtx ? { num_ctx: options.numCtx } : {}) },
        }),
      },
      options.timeoutMs ?? CHAT_TIMEOUT_MS,
    );
  } catch (error) {
    throw new ModelUnreachableError(`Lost contact with the model (${describeFailure(error)})`);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new ModelUnreachableError(`The model returned HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  const data = (await response.json()) as { message?: { content?: string } };
  return data.message?.content ?? "";
}
