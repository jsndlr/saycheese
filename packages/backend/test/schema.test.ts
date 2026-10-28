import { ERROR_CODES } from "@saycheese/core/errors";
import type { ErrorCode } from "@saycheese/core/errors";
import { convexTest } from "convex-test";
import type { TestConvex } from "convex-test";
import { expect, expectTypeOf, it } from "vitest";
import type { Infer } from "convex/values";

import schema from "../convex/schema";
import {
  auditAction,
  errorCode,
  imageStatus,
  scoreStatus,
  scoringOutcome,
} from "../convex/validators";
import type { Doc } from "../convex/_generated/dataModel";

type Test = TestConvex<typeof schema>;
type TableName = "images" | "scores" | "scoringAttempts" | "auditEvents";

const SHA256 = "0".repeat(64);

// convex-test needs an explicit module map; its `import.meta.glob` fallback is
// not transformed for this project.
const modules = import.meta.glob("../convex/**/*.ts");

/**
 * Inserts a raw document. The cast keeps intentionally invalid documents
 * type-checkable; runtime validation is exactly what these cases exercise.
 */
async function insertRaw(t: Test, table: TableName, doc: object) {
  return t.run(async (ctx) => ctx.db.insert(table as never, doc as never));
}

const validScore = {
  sha256: SHA256,
  score: 87,
  confidence: 99,
  faceCount: 1,
  status: "scored",
  reason: "smile",
  provider: "stub",
  providerModel: "stub-1",
  configVersion: "scoring-v1",
  latencyMs: 12,
  createdAt: 1_700_000_000_000,
} as const;

const validImage = {
  userId: "user_1",
  sha256: SHA256,
  mime: "image/jpeg",
  bytes: 1,
  status: "ready",
  createdAt: 1_700_000_000_000,
} as const;

const validAttempt = {
  imageId: "images_placeholder",
  provider: "stub",
  outcome: "success",
  latencyMs: 12,
  at: 1_700_000_000_000,
} as const;

const validAudit = {
  actorId: "user_1",
  action: "image.commit",
  table: "images",
  docId: "doc_1",
  at: 1_700_000_000_000,
} as const;

it("defines exactly the phase-1 tables plus the maintenance singleton", () => {
  expect(Object.keys(schema.tables).sort()).toEqual([
    "auditEvents",
    "images",
    "maintenance",
    "scores",
    "scoringAttempts",
  ]);
});

it("exposes the four tables through the generated data model", () => {
  expectTypeOf<Doc<"images">["status"]>().toEqualTypeOf<Infer<typeof imageStatus>>();
  expectTypeOf<Doc<"images">["failureCode"]>().toEqualTypeOf<
    Infer<typeof errorCode> | undefined
  >();
  expectTypeOf<Doc<"scores">["status"]>().toEqualTypeOf<Infer<typeof scoreStatus>>();
  expectTypeOf<Doc<"scoringAttempts">["outcome"]>().toEqualTypeOf<
    Infer<typeof scoringOutcome>
  >();
  expectTypeOf<Doc<"auditEvents">["action"]>().toEqualTypeOf<Infer<typeof auditAction>>();
});

it("accepts a valid row in every table", async () => {
  const t = convexTest(schema, modules);

  const scoreId = await t.run(async (ctx) => ctx.db.insert("scores", validScore));

  const imageId = await t.run(async (ctx) =>
    ctx.db.insert("images", {
      ...validImage,
      width: 1600,
      height: 1200,
      scoreId,
    }),
  );

  await t.run(async (ctx) =>
    ctx.db.insert("scoringAttempts", { ...validAttempt, imageId }),
  );

  await t.run(async (ctx) =>
    ctx.db.insert("auditEvents", {
      ...validAudit,
      docId: imageId,
      before: { status: "processing" },
      after: { status: "ready" },
    }),
  );

  await t.run(async (ctx) =>
    ctx.db.insert("maintenance", { key: "storageSweep", watermark: 1_700_000_000_000 }),
  );

  await expect(t.run(async (ctx) => ctx.db.get(imageId))).resolves.toMatchObject({
    status: "ready",
  });
});

it("accepts every core error code as failureCode", async () => {
  const t = convexTest(schema, modules);

  for (const code of ERROR_CODES) {
    await t.run(async (ctx) =>
      ctx.db.insert("images", {
        ...validImage,
        status: "failed",
        failureCode: code,
      }),
    );
  }
});

it("derives the errorCode validator from core ERROR_CODES with no drift", () => {
  expect(errorCode.kind).toBe("union");

  const literals = errorCode.members.map((member) => member.value);

  expect([...literals].sort()).toEqual([...ERROR_CODES].sort());
  expectTypeOf<Infer<typeof errorCode>>().toEqualTypeOf<ErrorCode>();
});

it("rejects invalid rows", async () => {
  const t = convexTest(schema, modules);

  const imageId = await t.run(async (ctx) => ctx.db.insert("images", validImage));

  await expect(
    insertRaw(t, "images", { ...validImage, status: "exploded" }),
  ).rejects.toThrow(/Validator error/);

  await expect(
    insertRaw(t, "images", {
      userId: "user_1",
      sha256: SHA256,
      bytes: 1,
      status: "ready",
      createdAt: 1,
    }),
  ).rejects.toThrow(/Missing required field `mime`/);

  await expect(
    insertRaw(t, "images", { ...validImage, failureCode: "NOT_A_CODE" }),
  ).rejects.toThrow(/Validator error/);

  await expect(
    insertRaw(t, "scores", { ...validScore, score: "87" }),
  ).rejects.toThrow(/Validator error/);

  await expect(
    insertRaw(t, "scoringAttempts", { ...validAttempt, imageId, outcome: "maybe" }),
  ).rejects.toThrow(/Validator error/);

  await expect(
    insertRaw(t, "auditEvents", { ...validAudit, action: "image.delete" }),
  ).rejects.toThrow(/Validator error/);
});