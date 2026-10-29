import { createRekognitionProvider } from "./rekognition";
import { stubProvider } from "./stub";
import { ProviderError, type ProviderName, type SmileProvider } from "./types";

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
    case "vision":
      throw new ProviderError(
        "fatal",
        "adapter_unimplemented",
        `Smile provider "${name}" is not implemented yet (Phase 3 task 5).`,
      );
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
 * The provider this phase scores with: first in plan order, no fallback yet
 * (task 5 adds the remaining ones). Callers that cannot throw should catch
 * `ProviderError`; the adapters 4/5 add are not implemented yet.
 */
export function primaryProvider(env: ProviderEnv): SmileProvider {
  return providerFor(providerOrder(env)[0], env);
}