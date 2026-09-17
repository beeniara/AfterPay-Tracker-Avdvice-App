import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { getDb, type Db } from "./index";
import type { User } from "./schema";

export interface PageContext {
  db: Db;
  user: User;
  today: string;
}

export async function getPageContext(): Promise<PageContext | null> {
  const db = getDb();
  const user = await currentUser(db);
  if (!user) return null;
  return { db, user, today: todayIso(user.timeZone) };
}

export async function requirePageContext(): Promise<PageContext> {
  const ctx = await getPageContext();
  if (!ctx) redirect("/login");
  return ctx;
}
