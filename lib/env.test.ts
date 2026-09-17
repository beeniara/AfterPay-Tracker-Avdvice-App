import { afterEach, describe, expect, it } from "vitest";
import { getEnv, resetEnvCache } from "./env";

const original = process.env.DATABASE_URL;

afterEach(() => {
  process.env.DATABASE_URL = original;
  resetEnvCache();
});

describe("getEnv", () => {
  it("returns the parsed database url", () => {
    process.env.DATABASE_URL = "postgres://u:p@localhost:5432/db";
    resetEnvCache();
    expect(getEnv().DATABASE_URL).toBe("postgres://u:p@localhost:5432/db");
  });

  it("throws a readable error when the url is missing", () => {
    delete process.env.DATABASE_URL;
    resetEnvCache();
    expect(() => getEnv()).toThrow(/DATABASE_URL/);
  });
});
