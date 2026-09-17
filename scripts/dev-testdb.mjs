// Runs the dev server against TEST_DATABASE_URL on port 3101 so the seeded
// demo/e2e data can be browsed without touching the real database.
import "dotenv/config";
import { spawn } from "node:child_process";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("TEST_DATABASE_URL is not set");
  process.exit(1);
}

const child = spawn("pnpm", ["exec", "next", "dev", "--turbopack", "-p", "3101"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, DATABASE_URL: url },
});
child.on("exit", (code) => process.exit(code ?? 0));
