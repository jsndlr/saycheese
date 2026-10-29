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
};

export function providerFor(name: ProviderName, _env: ProviderEnv): SmileProvider {
  switch (name) {
    case "stub":
      return stubProvider;
    case "rekognition":
    case "vision":
      throw new ProviderError(
        "fatal",
        "adapter_unimplemented",
        `Smile provider "${name}" is not implemented yet (Phase 3 tasks 4/5).`,
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