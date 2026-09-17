import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;

function createDb() {
  const client = postgres(getEnv().DATABASE_URL, { max: 10 });
  return drizzle({ client, schema });
}

const globalForDb = globalThis as unknown as { __owingDb?: Db };

// Reused across hot reloads so dev doesn't leak connections.
export function getDb(): Db {
  if (!globalForDb.__owingDb) {
    globalForDb.__owingDb = createDb();
  }
  return globalForDb.__owingDb;
}
