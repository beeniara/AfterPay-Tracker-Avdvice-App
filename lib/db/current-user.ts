import { asc } from "drizzle-orm";
import type { DbClient } from "./index";
import { users, type User } from "./schema";

// Single-user app: until auth lands, the account is whichever user exists.
export async function getCurrentUser(db: DbClient): Promise<User | null> {
  const user = await db.query.users.findFirst({ orderBy: [asc(users.createdAt)] });
  return user ?? null;
}
