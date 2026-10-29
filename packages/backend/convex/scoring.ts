import { mapProviderResult, type ProviderResult } from "@saycheese/core/scoring";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { env } from "./env";
import {
  isRetryable,
  ProviderError,
  type ProviderName,
  type SmileProvider,
} from "./lib/providers/types";
import { primaryProvider, providerOrder } from "./lib/providers";
import {
  SCORING_CALL_TIMEOUT_MS,
  SCORING_RETRY_DELAY_MS,
  SCORING_RETRY_JITTER_MS,
  SCORING_TOTAL_BUDGET_MS,
} from "./lib/scoringPolicy";
import type { ScoreResult, ScoringAttempt } from "./internal/scoring";
import { unavailableResult } from "./internal/scoring";

/**
 * Plan 6.2 scoring action.
 *
 * One image, one provider (`providerOrder(env)[0]`, the stub by default):
 * - 6 s per provider call via AbortController;
 * - exactly one retry, after 200 ms ± 50 ms of jitter, for retryable errors
 *   and timeouts only;
 * - the whole call sequence must finish within 10 s.
 *
 * Retry ownership: this action, not the workpool. The workpool's retry is
 * disabled, so each attempt is visible in `scoringAttempts` and all attempts
 * share the same 10 s budget. A failing attempt holds its workpool slot while
 * it waits, which is intended: four provider calls at a time, retries included.
 *
 * No cache (task 3), no fallback provider (task 5), no per-user rate limit
 * (task 6).
 */

type ProviderCall =
  | { kind: "result"; result: ProviderResult; latencyMs: number }
  | { kind: "error"; attempt: ScoringAttempt; retryable: boolean };

function log(event: string, fields: Record<string, unknown>): void {
  // Structured only: ids, provider names, outcomes and timings. Never bytes or
  // storage URLs.
  console.log(JSON.stringify({ event, ...fields }));
}

async function callProvider(
  provider: SmileProvider,
  input: {
    bytes: Uint8Array;
    mime: string;
    sha256: string;
    timeoutMs: number;
  },
): Promise<ProviderCall> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, input.timeoutMs);

  const startedAt = Date.now();
  try {
    const result = await provider.score({
      bytes: input.bytes,
      mime: input.mime,
      sha256: input.sha256,
      signal: controller.signal,
    });
    return { kind: "result", result, latencyMs: Date.now() - startedAt };
  } catch (error) {
    const at = Date.now();
    const latencyMs = at - startedAt;
    if (timedOut) {
      return {
        kind: "error",
        retryable: true,
        attempt: {
          provider: provider.name,
          outcome: "timeout",
          errorCode: "timeout",
          latencyMs,
          at,
        },
      };
    }
    if (error instanceof ProviderError) {
      const retryable = isRetryable(error);
      return {
        kind: "error",
        retryable,
        attempt: {
          provider: provider.name,
          outcome: retryable ? "retryable_error" : "fatal_error",
          errorCode: error.code,
          latencyMs,
          at,
        },
      };
    }
    // An adapter that throws something untyped is a bug; retrying it is not
    // useful, and the row must still reach a terminal state.
    return {
      kind: "error",
      retryable: false,
      attempt: {
        provider: provider.name,
        outcome: "fatal_error",
        errorCode: "unexpected_error",
        latencyMs,
        at,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

function retryDelayMs(): number {
  return (
    SCORING_RETRY_DELAY_MS +
    (Math.random() * 2 - 1) * SCORING_RETRY_JITTER_MS
  );
}

/**
 * Maps a provider answer with the core rules. `configVersion` comes from
 * `SCORING_CONFIG_VERSION` (env wins over core's `CONFIG_VERSION`): it is the
 * operational cache-invalidation switch and the seed already writes it, so
 * demo rows and live rows agree. Core's constant remains the mapping default.
 */
function toScoreResult(
  provider: SmileProvider,
  result: ProviderResult,
  configVersion: string,
): ScoreResult {
  const mapped = mapProviderResult(
    result,
    provider.name === "vision"
      ? {
          provider: "vision",
          providerModel: provider.model,
          cached: false,
          // TODO(task 5): the Vision adapter must carry the joy likelihood.
          joyLikelihood: "",
        }
      : {
          provider: provider.name,
          providerModel: provider.model,
          // TODO(task 3): read/write the score cache here.
          cached: false,
        },
  );

  return {
    score: mapped.score,
    confidence: mapped.confidence,
    faceCount: mapped.faceCount,
    status: mapped.status,
    reason: mapped.reason,
    provider: mapped.provider,
    providerModel: mapped.providerModel,
    configVersion,
    latencyMs: mapped.latencyMs,
    costMicros: result.costMicros,
  };
}

export const score = internalAction({
  args: { imageId: v.id("images") },
  handler: async (ctx, { imageId }) => {
    const target = await ctx.runQuery(internal.internal.scoring.load, {
      imageId,
    });
    if (target === null) {
      // Not `scoring` any more, or no variant to read: a duplicate run is a
      // no-op by design.
      return;
    }

    const primaryName: ProviderName = providerOrder(env)[0];
    let provider: SmileProvider | null = null;
    try {
      provider = primaryProvider(env);
    } catch (error) {
      const code = error instanceof ProviderError ? error.code : "unexpected_error";
      log("image.scoring.provider_missing", {
        imageId,
        provider: primaryName,
        outcome: "fatal_error",
        errorCode: code,
      });
    }

    let bytes: Uint8Array;
    try {
      const blob = await ctx.storage.get(target.storageId);
      if (blob === null) {
        throw new Error("stored variant is missing");
      }
      bytes = new Uint8Array(await blob.arrayBuffer());
    } catch (error) {
      log("image.scoring.read_failed", {
        imageId,
        provider: primaryName,
        outcome: "fatal_error",
        errorCode: error instanceof Error ? error.message : String(error),
      });
      await ctx.runMutation(internal.internal.scoring.record, {
        imageId,
        result: unavailableResult({
          provider: primaryName,
          providerModel: provider?.model ?? "unknown",
          configVersion: env.SCORING_CONFIG_VERSION,
          latencyMs: 0,
        }),
        attempts: [],
      });
      return;
    }

    if (provider === null) {
      await ctx.runMutation(internal.internal.scoring.record, {
        imageId,
        result: unavailableResult({
          provider: primaryName,
          providerModel: "unknown",
          configVersion: env.SCORING_CONFIG_VERSION,
          latencyMs: 0,
        }),
        attempts: [],
      });
      return;
    }

    const startedAt = Date.now();
    const deadline = startedAt + SCORING_TOTAL_BUDGET_MS;
    const attempts: ScoringAttempt[] = [];

    for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        break;
      }

      const call = await callProvider(provider, {
        bytes,
        // Scoring always uses the re-encoded original WebP variant, so the
        // provider is told image/webp even though the upload may be JPEG/PNG.
        mime: target.mime,
        sha256: target.sha256,
        timeoutMs: Math.min(SCORING_CALL_TIMEOUT_MS, remaining),
      });

      if (call.kind === "result") {
        attempts.push({
          provider: provider.name,
          outcome: "success",
          latencyMs: call.latencyMs,
          at: Date.now(),
        });
        const result = toScoreResult(provider, call.result, env.SCORING_CONFIG_VERSION);
        const recorded = await ctx.runMutation(internal.internal.scoring.record, {
          imageId,
          result,
          attempts,
        });
        log("image.scoring.result", {
          imageId,
          provider: provider.name,
          outcome: result.status,
          latencyMs: call.latencyMs,
          recorded,
        });
        return;
      }

      attempts.push(call.attempt);
      log("image.scoring.attempt", {
        imageId,
        provider: provider.name,
        outcome: call.attempt.outcome,
        latencyMs: call.attempt.latencyMs,
      });

      if (!call.retryable || attemptIndex === 1) {
        break;
      }

      const delay = retryDelayMs();
      if (Date.now() + delay >= deadline) {
        break;
      }
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, delay);
      await promise;
    }

    const elapsed = Date.now() - startedAt;
    const result = unavailableResult({
      provider: provider.name,
      providerModel: provider.model,
      configVersion: env.SCORING_CONFIG_VERSION,
      latencyMs: elapsed,
    });
    const recorded = await ctx.runMutation(internal.internal.scoring.record, {
      imageId,
      result,
      attempts,
    });
    log("image.scoring.result", {
      imageId,
      provider: provider.name,
      outcome: result.status,
      latencyMs: elapsed,
      recorded,
    });
  },
});