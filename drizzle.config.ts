import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { getEnv } from "./lib/env";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: getEnv().DATABASE_URL },
  strict: true,
  verbose: true,
});
