import "dotenv/config";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": root },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
    coverage: {
      provider: "v8",
      include: ["lib/money.ts", "lib/ledger.ts", "lib/dates.ts", "lib/csv.ts"],
      reporter: ["text", "html"],
      thresholds: { branches: 95, lines: 95, functions: 95 },
    },
  },
});
