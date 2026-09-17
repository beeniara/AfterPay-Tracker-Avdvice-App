export type ApiResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function sendJson<T = unknown>(
  method: "POST" | "PATCH" | "DELETE",
  url: string,
  body?: object,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, error: "Network error — check your connection and try again" };
  }
  if (response.status === 204) return { ok: true, data: undefined as T };
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
        ? data.error
        : `Request failed (${response.status})`;
    return { ok: false, error: message };
  }
  return { ok: true, data: data as T };
}

export function formToObject(form: HTMLFormElement): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of new FormData(form)) {
    out[key] = typeof value === "string" ? value : undefined;
  }
  for (const box of form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    if (box.name) out[box.name] = box.checked;
  }
  return out;
}
