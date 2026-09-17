import { todayIso } from "@/lib/dates";
import { getCurrentUser } from "./current-user";
import { getDb, type Db } from "./index";
import type { User } from "./schema";

export interface PageContext {
  db: Db;
  user: User;
  today: string;
}

export async function getPageContext(): Promise<PageContext | null> {
  const db = getDb();
  const user = await getCurrentUser(db);
  if (!user) return null;
  return { db, user, today: todayIso(user.timeZone) };
}
