import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.url(),
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
