import { useSyncExternalStore } from "react";
import type { ModelStatus } from "@/lib/ask/ollama";

// The Ask box owns the polling of the model PC (and the wake/shutdown flow). It
// publishes each result here so other cards on the page, like the pay-off plan,
// can enable themselves the moment the model is ready without polling again.

export type SharedModelStatus = ModelStatus | "checking";

let current: SharedModelStatus = "checking";
const listeners = new Set<() => void>();

export function publishStatus(next: SharedModelStatus): void {
  // Polling republishes an identical status every few seconds; only real changes re-render.
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// "checking" on the server and until the Ask box reports, so the first HTML always matches.
export function useModelStatus(): SharedModelStatus {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => "checking",
  );
}
