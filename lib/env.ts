import { z } from "zod";

const blankToUndefined = (value: unknown) => (value === "" ? undefined : value);

const envSchema = z.object({
  DATABASE_URL: z.url(),
  TEST_DATABASE_URL: z.url().optional(),
  OLLAMA_URL: z.preprocess(blankToUndefined, z.url().optional()),
  OLLAMA_MODEL: z.preprocess(blankToUndefined, z.string().min(1).optional()),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
    }
    cached = result.data;
  }
  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}
