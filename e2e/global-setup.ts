import "dotenv/config";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { hashPassword } from "@/lib/auth/password";
import { createDb } from "@/lib/db";
import { providers, users } from "@/lib/db/schema";

export const E2E_USER = { email: "e2e@example.test", password: "e2e-password-123" };

export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is required for e2e tests");
  const db = createDb(url, 1);
  await migrate(db, { migrationsFolder: "drizzle" });

  // Deleting the user cascades to its orders, so every run starts clean.
  await db.delete(users).where(eq(users.email, E2E_USER.email));
  const [user] = await db
    .insert(users)
    .values({ email: E2E_USER.email, name: "E2E Tester", passwordHash: await hashPassword(E2E_USER.password) })
    .returning();
  await db.insert(providers).values({ userId: user!.id, name: "E2E Pay", kind: "bnpl" });
  await db.$client.end();
}
