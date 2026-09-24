import { z } from "zod";

const blankToUndefined = (value: unknown) => (value === "" ? undefined : value);

const envSchema = z.object({
  DATABASE_URL: z.url(),
  TEST_DATABASE_URL: z.url().optional(),
  OLLAMA_URL: z.preprocess(blankToUndefined, z.url().optional()),
  OLLAMA_MODEL: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  // Optional different model for the pay-off plan (a general model plans better than the
  // coder model Ask needs for SQL). Blank, or not installed: the plan uses OLLAMA_MODEL.
  OLLAMA_ADVICE_MODEL: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  // Wake-on-LAN for the Ollama PC. The app never sends the packet itself (a
  // Docker bridge can't broadcast onto the LAN); it asks the host-network "wol"
  // sidecar through the shared spool folder. Blank MAC disables waking.
  PC_MAC_ADDRESS: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  WOL_SPOOL_DIR: z.preprocess(blankToUndefined, z.string().min(1).default("/spool")),
  // Only these account emails may wake the PC. Empty = nobody.
  WAKE_ALLOWED_EMAILS: z.preprocess(
    (v) =>
      typeof v === "string"
        ? v
            .split(",")
            .map((e) => e.trim().toLowerCase())
            .filter(Boolean)
        : [],
    z.array(z.string()),
  ),
  // Remote shutdown over SSH (done by the same sidecar). Blank host disables it.
  // Only WAKE_ALLOWED_EMAILS may use it.
  PC_SSH_HOST: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  // How long after a wake an unreachable PC counts as "waking" (boot takes ~30-90s).
  WAKE_WINDOW_SECONDS: z.preprocess(blankToUndefined, z.coerce.number().int().positive().default(180)),
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
