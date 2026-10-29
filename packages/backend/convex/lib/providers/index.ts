import { createRekognitionProvider } from "./rekognition";
import { stubProvider } from "./stub";
import { ProviderError, type ProviderName, type SmileProvider } from "./types";
import { createVisionProvider } from "./vision";

/**
 * Selection layer. `env` is threaded through so the real adapters (tasks 4/5)
 * can read credentials and region without changing call sites; the stub needs
 * none of it. `name` is explicit rather than read from `env` so task 5 can
 * build the fallback provider as well as the primary.
 */

export type ProviderEnv = {
  SMILE_PROVIDER: ProviderName;
  AWS_REGION?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  GOOGLE_APPLICATION_CREDENTIALS_JSON?: string;
};

export function providerFor(name: ProviderName, env: ProviderEnv): SmileProvider {
  switch (name) {
    case "stub":
      return stubProvider;
    case "rekognition": {
      const { AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY } = env;
      if (!AWS_REGION || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
        throw new ProviderError(
          "fatal",
          "missing_credentials",
          "SMILE_PROVIDER=rekognition requires AWS_REGION, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.",
        );
      }
      return createRekognitionProvider({
        region: AWS_REGION,
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY,
      });
    }
    case "vision": {
      const raw = env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
      if (!raw) {
        throw new ProviderError(
          "fatal",
          "missing_credentials",
          "SMILE_PROVIDER=vision requires GOOGLE_APPLICATION_CREDENTIALS_JSON.",
        );
      }

      let parsed: { client_email?: unknown; private_key?: unknown; token_uri?: unknown };
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        throw new ProviderError(
          "fatal",
          "invalid_credentials",
          "GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON.",
        );
      }

      if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") {
        throw new ProviderError(
          "fatal",
          "invalid_credentials",
          "GOOGLE_APPLICATION_CREDENTIALS_JSON must contain client_email and private_key.",
        );
      }

      return createVisionProvider({
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key,
        tokenUri: typeof parsed.token_uri === "string" ? parsed.token_uri : undefined,
      });
    }
    default: {
      const unknown: never = name;
      throw new ProviderError(
        "fatal",
        "unknown_provider",
        `Unknown smile provider: ${String(unknown)}.`,
      );
    }
  }
}

/**
 * Plan 6.2 order: try the primary, then fall back. Stub and Vision have no
 * cross-provider fallback; Rekognition falls back to Vision.
 */
export function providerOrder(env: ProviderEnv): readonly ProviderName[] {
  switch (env.SMILE_PROVIDER) {
    case "rekognition":
      return ["rekognition", "vision"];
    case "vision":
      return ["vision"];
    case "stub":
      return ["stub"];
    default: {
      const unknown: never = env.SMILE_PROVIDER;
      throw new ProviderError(
        "fatal",
        "unknown_provider",
        `Unknown smile provider: ${String(unknown)}.`,
      );
    }
  }
}

/**
 * The configured primary provider (first in plan order). The scoring action
 * walks `providerOrder` itself so it can fall back; this helper remains for
 * callers that only need the primary's model label (the stuck sweep).
 */
export function primaryProvider(env: ProviderEnv): SmileProvider {
  return providerFor(providerOrder(env)[0], env);
}