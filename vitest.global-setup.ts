import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./lib/db";

// Runs once per test run so parallel DB test files don't race on migrations.
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const db = createDb(url, 1);
  await migrate(db, { migrationsFolder: "drizzle" });
  await db.$client.end();
}
