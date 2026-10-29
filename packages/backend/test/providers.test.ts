import { randomBytes } from "node:crypto";

import { mapProviderResult, type ProviderResult } from "@saycheese/core/scoring";
import { describe, expect, it } from "vitest";

import { providerFor, providerOrder } from "../convex/lib/providers";
import {
  STUB_MODEL,
  STUB_TEST_COMMAND,
  STUB_TEST_PREFIX,
  stubProvider,
} from "../convex/lib/providers/stub";
import { ProviderError, isRetryable } from "../convex/lib/providers/types";

/**
 * Core already covers the mapping table itself (plan 9.1 T-SCR-01..08) in
 * packages/core/src/scoring.test.ts. These tests only cover the stub and the
 * selection wiring: every assertion below runs real results through
 * `mapProviderResult` instead of restating mapping rules.
 */

function sha256With(prefix: string): string {
  return prefix.padEnd(64, "0");
}

function delayHash(ms: number): string {
  return sha256With(
    `${STUB_TEST_PREFIX}${STUB_TEST_COMMAND.delay}${ms.toString(16).padStart(4, "0")}`,
  );
}

function input(sha256: string, signal?: AbortSignal) {
  return { bytes: new Uint8Array([1, 2, 3]), mime: "image/webp", sha256, signal };
}

function score(sha256: string, signal?: AbortSignal): Promise<ProviderResult> {
  return stubProvider.score(input(sha256, signal));
}

const stubMeta = {
  provider: "stub",
  providerModel: STUB_MODEL,
  cached: false,
} as const;

function mapped(result: ProviderResult) {
  return mapProviderResult(result, stubMeta);
}

function caught(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error;
  }
}

const FIXTURES = {
  scoredLow: sha256With("600000"),
  scoredHigh: sha256With("600050"),
  noFace: sha256With("00"),
  multipleFaces: sha256With("20"),
  lowConfidence: sha256With("40"),
  lowSharpness: sha256With("50"),
  unavailable: sha256With(`${STUB_TEST_PREFIX}${STUB_TEST_COMMAND.resultError}`),
} as const;

describe("deterministic stub", () => {
  it("T-SCR-09: returns a deep-equal result for the same sha256", async () => {
    const hashes = Array.from({ length: 1000 }, () => randomBytes(32).toString("hex"));

    for (const sha256 of hashes) {
      const first = await score(sha256);
      const second = await score(sha256);
      expect(second).toEqual(first);
      expect(first.latencyMs).toBeGreaterThanOrEqual(1);
      expect(first.latencyMs).toBeLessThanOrEqual(5);
      expect(first.costMicros).toBe(0);
    }

    expect(stubProvider.name).toBe("stub");
    expect(stubProvider.model).toBe("stub-v1");
  });

  it("T-SCR-10: produces every ScoreStatus after mapping", async () => {
    const statuses = new Set<string>();
    for (const sha256 of Object.values(FIXTURES)) {
      statuses.add(mapped(await score(sha256)).status);
    }

    expect(statuses).toEqual(
      new Set(["scored", "no_face", "multiple_faces", "low_quality", "unavailable"]),
    );
  });

  it("T-SCR-11: scored results span 10..90", async () => {
    const low = mapped(await score(FIXTURES.scoredLow));
    const high = mapped(await score(FIXTURES.scoredHigh));

    expect(low.status).toBe("scored");
    expect(low.score).toBe(10);
    expect(high.status).toBe("scored");
    expect(high.score).toBe(90);

    const randomScores: number[] = [];
    for (let index = 0; index < 500; index += 1) {
      const result = mapped(await score(randomBytes(32).toString("hex")));
      if (result.status === "scored" && result.score !== null) randomScores.push(result.score);
    }
    expect(randomScores.length).toBeGreaterThan(0);
    expect(Math.min(...randomScores)).toBeGreaterThanOrEqual(10);
    expect(Math.max(...randomScores)).toBeLessThanOrEqual(90);
  });
});

describe("stub test overrides", () => {
  it("T-SCR-12: classifies retryable and fatal errors", async () => {
    const retryable = await score(sha256With(`${STUB_TEST_PREFIX}${STUB_TEST_COMMAND.retryable}`)).catch(
      (error: unknown) => error,
    );
    expect(retryable).toBeInstanceOf(ProviderError);
    expect(retryable).toMatchObject({ kind: "retryable", code: "stub_retryable" });
    expect(isRetryable(retryable)).toBe(true);

    const fatal = await score(sha256With(`${STUB_TEST_PREFIX}${STUB_TEST_COMMAND.fatal}`)).catch(
      (error: unknown) => error,
    );
    expect(fatal).toBeInstanceOf(ProviderError);
    expect(fatal).toMatchObject({ kind: "fatal", code: "stub_fatal" });
    expect(isRetryable(fatal)).toBe(false);
    expect(isRetryable(new Error("plain"))).toBe(false);
  });

  it("T-SCR-13: honours a delay and rejects when aborted", async () => {
    const started = performance.now();
    const delayed = mapped(await score(delayHash(25)));
    expect(performance.now() - started).toBeGreaterThanOrEqual(20);
    expect(delayed.status).toBe("scored");

    const controller = new AbortController();
    const pending = score(delayHash(5000), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("T-SCR-14: rejects an already-aborted signal with AbortError", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(score(FIXTURES.scoredLow, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("T-SCR-15: the result-error override maps to unavailable", async () => {
    const result = await score(FIXTURES.unavailable);
    expect(result.error).toBeDefined();
    expect(mapped(result)).toMatchObject({ status: "unavailable", score: null, faceCount: 0 });
  });
});

describe("provider selection", () => {
  it("T-SCR-16: returns the stub by default, Rekognition with credentials, and rejects Vision", () => {
    expect(providerFor("stub", { SMILE_PROVIDER: "stub" })).toBe(stubProvider);

    const rekognition = providerFor("rekognition", {
      SMILE_PROVIDER: "rekognition",
      AWS_REGION: "eu-central-1",
      AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
      AWS_SECRET_ACCESS_KEY: "not-a-real-secret",
    });
    expect(rekognition.name).toBe("rekognition");

    const missing = caught(() => providerFor("rekognition", { SMILE_PROVIDER: "rekognition" }));
    expect(missing).toBeInstanceOf(ProviderError);
    expect(missing).toMatchObject({ kind: "fatal", code: "missing_credentials" });
    expect(isRetryable(missing)).toBe(false);

    const vision = caught(() => providerFor("vision", { SMILE_PROVIDER: "vision" }));
    expect(vision).toBeInstanceOf(ProviderError);
    expect(vision).toMatchObject({ kind: "fatal", code: "missing_credentials" });
    expect(isRetryable(vision)).toBe(false);
  });

  it("T-SCR-17: providerOrder follows plan 6.2", () => {
    expect(providerOrder({ SMILE_PROVIDER: "rekognition" })).toEqual(["rekognition", "vision"]);
    expect(providerOrder({ SMILE_PROVIDER: "vision" })).toEqual(["vision"]);
    expect(providerOrder({ SMILE_PROVIDER: "stub" })).toEqual(["stub"]);
  });
});