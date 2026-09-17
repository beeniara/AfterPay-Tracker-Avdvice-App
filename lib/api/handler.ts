import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPageContext, type PageContext } from "@/lib/db/context";
import { ConflictError, NotFoundError } from "@/lib/db/mutations";
import { InvalidMoneyError } from "@/lib/money";

export class UnauthorizedError extends Error {
  constructor(message = "Sign in required") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

export async function requireContext(): Promise<PageContext> {
  const ctx = await getPageContext();
  if (!ctx) throw new UnauthorizedError();
  return ctx;
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  return schema.parse(body ?? {});
}

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof z.ZodError) return jsonError(400, z.prettifyError(error));
  if (error instanceof InvalidMoneyError || error instanceof RangeError) {
    return jsonError(400, error.message);
  }
  if (error instanceof UnauthorizedError) return jsonError(401, error.message);
  if (error instanceof NotFoundError) return jsonError(404, error.message);
  if (error instanceof ConflictError) return jsonError(409, error.message);
  console.error(error);
  return jsonError(500, "Something went wrong");
}

export function revalidateMoneyPaths(orderId?: string): void {
  for (const path of ["/", "/orders", "/upcoming", "/insights", "/providers"]) revalidatePath(path);
  if (orderId) revalidatePath(`/orders/${orderId}`);
}
