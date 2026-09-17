import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { handleApiError, jsonError, parseBody, readJson, requireContext } from "@/lib/api/handler";
import { profileSchema } from "@/lib/api/schemas";
import { users } from "@/lib/db/schema";

function publicUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    currency: user.currency,
    timeZone: user.timeZone,
    hasPassword: user.passwordHash !== null,
  };
}

export async function GET() {
  try {
    const { user } = await requireContext();
    return NextResponse.json(publicUser(user));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { db, user } = await requireContext();
    const input = parseBody(profileSchema, await readJson(request));
    try {
      const [updated] = await db
        .update(users)
        .set({
          email: input.email ?? user.email,
          name: input.name === undefined ? user.name : input.name,
          currency: input.currency ?? user.currency,
          timeZone: input.timeZone ?? user.timeZone,
        })
        .where(eq(users.id, user.id))
        .returning();
      revalidatePath("/", "layout");
      return NextResponse.json(publicUser(updated!));
    } catch (error) {
      if (typeof error === "object" && error !== null && "cause" in error) {
        const cause = error.cause as { code?: string } | undefined;
        if (cause?.code === "23505") return jsonError(409, "That email is already in use");
      }
      throw error;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
