import { convexTest } from "convex-test";
import type { TestConvex } from "convex-test";
import { fileTypeFromBuffer } from "file-type";
import { makeFunctionReference } from "convex/server";
import sharp from "sharp";
import { expect, it, vi } from "vitest";

import schema from "../convex/schema";
import * as ProviderTypes from "../convex/lib/providers/types";
import type { Doc, Id } from "../convex/_generated/dataModel";

/**
 * Provider image conversion: the stored variant is WebP, Rekognition accepts
 * JPEG/PNG, so the scoring action must convert before calling the provider.
 * The providers module is mocked to record exactly what the adapter receives.
 */

const recorder = vi.hoisted(() => ({
  calls: [] as { bytes: Uint8Array; mime: string; sha256: string; signal?: AbortSignal }[],
  failuresLeft: 0,
}));

vi.mock("../convex/lib/providers", async () => {
  // Static imports are above the hoisted mock; importActual loads the real
  // error class so the action's `instanceof ProviderError` retry path runs.
  const { ProviderError } = await vi.importActual<typeof ProviderTypes>(
    "../convex/lib/providers/types",
  );
  return {
    providerOrder: () => ["rekognition"],
    primaryProvider: () => ({
      name: "rekognition",
      model: "test-rekognition",
      acceptedMimes: ["image/jpeg"],
      score: async (input: {
        bytes: Uint8Array;
        mime: string;
        sha256: string;
        signal?: AbortSignal;
      }) => {
        recorder.calls.push(input);
        if (recorder.failuresLeft > 0) {
          recorder.failuresLeft -= 1;
          throw new ProviderError("retryable", "test_retry", "simulated retry");
        }
        return {
          faces: [
            {
              area: 0.2,
              smileConfidence: 90,
              smileValue: true,
              faceConfidence: 99,
              sharpness: 80,
            },
          ],
          latencyMs: 1,
          costMicros: 1_000,
        };
      },
    }),
  };
});

// Keeps the retry test fast: production timings would sleep 200 ms.
vi.mock("../convex/lib/scoringPolicy", () => ({
  SCORING_CALL_TIMEOUT_MS: 1_000,
  SCORING_TOTAL_BUDGET_MS: 5_000,
  SCORING_RETRY_DELAY_MS: 1,
  SCORING_RETRY_JITTER_MS: 0,
}));

const modules = import.meta.glob("../convex/**/*.ts");
const score = makeFunctionReference<"action", { imageId: Id<"images"> }, void>(
  "actions/scoring:score",
);

type Test = TestConvex<typeof schema>;

async function insertWebpImage(t: Test): Promise<Id<"images">> {
  const webp = await sharp({
    create: {
      width: 64,
      height: 48,
      channels: 3,
      background: { r: 120, g: 160, b: 200 },
    },
  })
    .webp()
    .toBuffer();

  return t.run(async (ctx) => {
    const storageId = await ctx.storage.store(
      new Blob([new Uint8Array(webp)], { type: "image/webp" }),
    );
    return await ctx.db.insert("images", {
      userId: "user-1",
      sha256: `62${"0".repeat(62)}`,
      storageId,
      mime: "image/webp",
      bytes: webp.byteLength,
      width: 64,
      height: 48,
      status: "scoring" as Doc<"images">["status"],
      scoringStartedAt: Date.now(),
      createdAt: 1_700_000_000_000,
    });
  });
}

it("converts the stored WebP to JPEG before calling a JPEG-only provider", async () => {
  recorder.calls = [];
  recorder.failuresLeft = 0;
  const t = convexTest(schema, modules);
  const imageId = await insertWebpImage(t);

  await t.action(score, { imageId });

  expect(recorder.calls).toHaveLength(1);
  const call = recorder.calls[0];
  expect(call?.mime).toBe("image/jpeg");
  expect(await fileTypeFromBuffer(call?.bytes ?? new Uint8Array())).toMatchObject({
    mime: "image/jpeg",
  });
  const metadata = await sharp(call?.bytes).metadata();
  expect(metadata).toMatchObject({ width: 64, height: 48 });

  const scoreRow = await t.run(async (ctx) => ctx.db.query("scores").first());
  expect(scoreRow).toMatchObject({ provider: "rekognition", status: "scored" });
});

it("converts once per action, not once per retry", async () => {
  recorder.calls = [];
  recorder.failuresLeft = 1;
  const t = convexTest(schema, modules);
  const imageId = await insertWebpImage(t);

  await t.action(score, { imageId });

  expect(recorder.calls).toHaveLength(2);
  expect(recorder.calls.map((call) => call.mime)).toEqual([
    "image/jpeg",
    "image/jpeg",
  ]);
  // Same byte array reused across attempts: conversion happened once.
  expect(recorder.calls[1]?.bytes).toBe(recorder.calls[0]?.bytes);

  const attempts = await t.run(async (ctx) =>
    ctx.db.query("scoringAttempts").collect(),
  );
  expect(attempts.map((attempt) => attempt.outcome)).toEqual([
    "retryable_error",
    "success",
  ]);
});