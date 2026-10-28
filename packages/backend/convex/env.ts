import { z } from "zod";

const providerSchema = z.enum(["stub", "rekognition", "vision"]);
const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);

const envSchema = z
  .object({
    BETTER_AUTH_SECRET: z.string().min(32),
    SITE_URL: z.url({ protocol: /^https?$/ }),
    SMILE_PROVIDER: providerSchema.default("stub"),
    SMILE_DAILY_QUOTA: z.coerce.number().int().positive().default(100),
    SCORING_CONFIG_VERSION: z.string().default("1"),
    LOG_LEVEL: logLevelSchema.default("info"),
    DEPLOYMENT_LABEL: z.string().optional(),
    // Dev-only demo account password used by `pnpm seed`.
    SEED_DEMO_PASSWORD: z.string().min(12).optional(),
    AWS_REGION: z.string().optional(),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    GOOGLE_APPLICATION_CREDENTIALS_JSON: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.SMILE_PROVIDER === "rekognition") {
      const missing = (["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"] as const).filter(
        (key) => !value[key],
      );
      if (missing.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["SMILE_PROVIDER"],
          message: `Missing required keys for SMILE_PROVIDER=rekognition: ${missing.join(", ")}.`,
        });
      }
    }

    if (value.SMILE_PROVIDER === "vision") {
      if (!value.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
        ctx.addIssue({
          code: "custom",
          path: ["GOOGLE_APPLICATION_CREDENTIALS_JSON"],
          message: "Required when SMILE_PROVIDER=vision.",
        });
        return;
      }

      try {
        JSON.parse(value.GOOGLE_APPLICATION_CREDENTIALS_JSON);
      } catch {
        ctx.addIssue({
          code: "custom",
          path: ["GOOGLE_APPLICATION_CREDENTIALS_JSON"],
          message: "Must be valid JSON when SMILE_PROVIDER=vision.",
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Validates an environment source. Error messages name keys only, never values.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${details}`);
  }
  return result.data;
}

// Convex's `process.env` is a proxy whose keys are not enumerable, and Zod's
// object parsing only reads own enumerable keys, so the values are copied out
// explicitly instead of passing `process.env` through.
export function readEnvSource(
  source: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const copy: Record<string, string | undefined> = {};
  for (const key of Object.keys(envSchema.shape)) {
    copy[key] = source[key];
  }
  return copy;
}

// Evaluated at module load: a deployment with a broken environment fails its
// push (Convex analyses module top-level code) instead of failing at call time.
export const env: Env = parseEnv(readEnvSource(process.env));
