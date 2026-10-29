"use node";

import { mapProviderResult, type ProviderResult } from "@saycheese/core/scoring";
import { v } from "convex/values";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { env } from "../env";
import {
  isRetryable,
  ProviderError,
  type ProviderName,
  type SmileProvider,
} from "../lib/providers/types";
import { providerFor, providerOrder } from "../lib/providers";
import { providerImage } from "../lib/providerImage";
import {
  SCORING_CALL_TIMEOUT_MS,
  SCORING_RETRY_DELAY_MS,
  SCORING_RETRY_JITTER_MS,
  SCORING_TOTAL_BUDGET_MS,
} from "../lib/scoringPolicy";
import type { ScoreResult, ScoringAttempt } from "../internal/scoring";
import { unavailableResult } from "../internal/scoring";

/**
 * Plan 6.2 scoring action.
 *
 * One image, providers in `providerOrder(env)` order (the stub by default):
 * - 6 s per provider call via AbortController;
 * - the primary gets exactly one retry, after 200 ms ± 50 ms of jitter, for
 *   retryable errors and timeouts only;
 * - a retryable/timeout primary failure falls back once to the next provider;
 * - the fallback may retry once too, but only when a full per-call timeout
 *   still fits in the remaining total budget;
 * - the whole sequence must finish within 10 s.
 *
 * Fatal primary errors (bad credentials, invalid image, permission denied)
 * never fall back: the fallback would repeat the same failure and hide a
 * deployment problem. A primary that cannot even be constructed is also
 * recorded as unavailable instead of silently switching providers.
 *
 * Retry ownership: this action, not the workpool. The workpool's retry is
 * disabled, so each attempt is visible in `scoringAttempts` and all attempts
 * share the same 10 s budget. A failing attempt holds its workpool slot while
 * it waits, which is intended: four provider calls at a time, retries included.
 *
 * The content cache is consulted once, for the primary provider, in
 * `tryCached` before any pixels or provider are touched; a hit ends the run.
 * If the fallback answers, the score row is keyed under the fallback provider
 * name (correct for its content). A later image with the same bytes looks up
 * the primary, misses, and pays one extra call; multi-provider cache lookups
 * are deliberately out of scope for this phase.
 *
 * Daily quota: after the cache miss, `claimDailyScore` consumes one unit of
 * the owner's `SMILE_DAILY_QUOTA` budget. A denied claim records an
 * `unavailable` score with the SCORING_QUOTA reason and `quotaExceeded: true`
 * and stops before any provider is constructed. Cache hits never consume.
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
          // Vision reports a per-face likelihood; an absent value maps to
          // `low_quality` in core rather than inventing a smile score.
          joyLikelihood: result.joyLikelihood ?? "",
        }
      : {
          provider: provider.name,
          providerModel: provider.model,
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
  // `run` is the image's scoring generation: a job from an older run can
  // never settle a newer one. `force` comes from an explicit rescore: skip the
  // cache lookup and replace the cacheable row with this run's result.
  // `run` has no legacy fallback: on 2026-10-29 prod had 0 images and dev had
  // no queued scoring job (only the seeded timestamp-less row), so no job was
  // enqueued without it.
  args: { imageId: v.id("images"), run: v.number(), force: v.optional(v.boolean()) },
  handler: async (ctx, { imageId, run, force }) => {
    const target = await ctx.runQuery(internal.internal.scoring.load, {
      imageId,
      run,
    });
    if (target === null) {
      // Not `scoring` any more, or no variant to read: a duplicate run is a
      // no-op by design.
      return;
    }

    const order = providerOrder(env);
    const primaryName: ProviderName = order[0];
    if (force !== true) {
      const cached = await ctx.runMutation(internal.internal.scoring.tryCached, {
        imageId,
        run,
        provider: primaryName,
        configVersion: env.SCORING_CONFIG_VERSION,
      });
      if (cached) {
        log("image.scoring.cached", { imageId, provider: primaryName });
        return;
      }
    }

    // Consumed only when a provider call is about to be attempted, and in a
    // mutation so a rolled-back run cannot leak budget.
    const budget = await ctx.runMutation(
      internal.internal.scoring.claimDailyScore,
      { imageId, run },
    );
    if (budget.skipped) {
      return;
    }
    if (!budget.ok) {
      const recorded = await ctx.runMutation(
        internal.internal.scoring.recordQuotaExceeded,
        {
          imageId,
          run,
          provider: primaryName,
          providerModel: "unknown",
          configVersion: env.SCORING_CONFIG_VERSION,
        },
      );
      log("image.scoring.quota_exceeded", {
        imageId,
        provider: primaryName,
        retryAfterMs: budget.retryAfterMs,
        recorded,
      });
      return;
    }

    const finishUnavailable = async (
      label: { name: ProviderName; model: string },
      latencyMs: number,
      attempts: ScoringAttempt[],
    ): Promise<void> => {
      const result = unavailableResult({
        provider: label.name,
        providerModel: label.model,
        configVersion: env.SCORING_CONFIG_VERSION,
        latencyMs,
      });
      const recorded = await ctx.runMutation(internal.internal.scoring.record, {
        imageId,
        run,
        result,
        attempts,
        force,
      });
      log("image.scoring.result", {
        imageId,
        provider: label.name,
        outcome: result.status,
        latencyMs,
        recorded,
      });
    };

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
      await finishUnavailable(
        { name: primaryName, model: "unknown" },
        0,
        [],
      );
      return;
    }

    const startedAt = Date.now();
    const deadline = startedAt + SCORING_TOTAL_BUDGET_MS;
    const attempts: ScoringAttempt[] = [];
    let primaryModel = "unknown";

    for (let orderIndex = 0; orderIndex < order.length; orderIndex += 1) {
      const name = order[orderIndex] as ProviderName;
      const isFallback = orderIndex > 0;

      let provider: SmileProvider;
      try {
        provider = providerFor(name, env);
      } catch (error) {
        const code = error instanceof ProviderError ? error.code : "unexpected_error";
        log("image.scoring.provider_missing", {
          imageId,
          provider: name,
          outcome: "fatal_error",
          errorCode: code,
        });
        if (!isFallback) {
          // A misconfigured primary is a deployment error, not a provider
          // outage: falling back would hide it and silently change the mapping.
          await finishUnavailable(
            { name: primaryName, model: "unknown" },
            Date.now() - startedAt,
            attempts,
          );
          return;
        }
        // A fallback without credentials is simply unavailable; the primary
        // attempts already recorded decide the outcome below.
        continue;
      }

      if (!isFallback) primaryModel = provider.model;

      // Rekognition accepts JPEG/PNG and Vision accepts all three; convert per
      // provider so a fallback gets the format its adapter accepts.
      const conversionStartedAt = Date.now();
      let image: { bytes: Uint8Array; mime: string };
      try {
        image = await providerImage(bytes, target.mime, provider.acceptedMimes);
      } catch (error) {
        const code = error instanceof ProviderError ? error.code : "unexpected_error";
        const latencyMs = Date.now() - conversionStartedAt;
        log("image.scoring.provider_image_failed", {
          imageId,
          provider: name,
          outcome: "fatal_error",
          errorCode: code,
        });
        // An image the provider cannot accept is terminal: another provider
        // would only repeat the same conversion failure.
        await finishUnavailable(
          { name: provider.name, model: provider.model },
          latencyMs,
          attempts,
        );
        return;
      }

      let retryableFailure = false;
      for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          retryableFailure = true;
          break;
        }

        const call = await callProvider(provider, {
          bytes: image.bytes,
          mime: image.mime,
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
            run,
            result,
            attempts,
            force,
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

        if (!call.retryable) {
          // Fatal primary errors do not fall back (bad credentials, bad image,
          // permission denied); a fatal fallback ends the run too.
          await finishUnavailable(
            { name: provider.name, model: provider.model },
            Date.now() - startedAt,
            attempts,
          );
          return;
        }

        retryableFailure = true;
        if (attemptIndex === 1) break;

        const delay = retryDelayMs();
        if (Date.now() + delay >= deadline) break;
        // Fallback retry rule: only when one full provider call still fits
        // after the wait. The primary already owns the ordinary retry.
        if (
          isFallback &&
          Date.now() + delay + SCORING_CALL_TIMEOUT_MS > deadline
        ) {
          break;
        }

        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, delay);
        await promise;
      }

      // Only a retryable/timeout primary failure reaches this point with more
      // providers left; the loop then tries the fallback once.
      if (!isFallback && retryableFailure) continue;
    }

    await finishUnavailable(
      { name: primaryName, model: primaryModel },
      Date.now() - startedAt,
      attempts,
    );
  },
});