import type { ComponentApi } from "@convex-dev/better-auth/_generated/component.js";
import { register } from "@convex-dev/better-auth/test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerWorkpool } from "@convex-dev/workpool/test";
import { MAX_UPLOAD_BYTES, UPLOAD_COMMIT_GRACE_MS, UPLOAD_URL_TTL_MS } from "@saycheese/core/limits";
import { convexTest } from "convex-test";
import type { TestConvex } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { expect, it, vi } from "vitest";

import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.ts");

type Test = TestConvex<typeof schema>;
type Component = ComponentApi;

type CommitArgs = {
  storageId: Id<"_storage">;
  sha256: string;
  bytes: number;
  mime: string;
};

const createUpload = makeFunctionReference<
  "mutation",
  Record<string, never>,
  { uploadUrl: string; expiresAt: number }
>("commands/images:createUpload");

const commitUpload = makeFunctionReference<
  "mutation",
  CommitArgs,
  { id: Id<"images">; deduplicated: boolean }
>("commands/images:commitUpload");

const JPEG = "image/jpeg";
const PNG = "image/png";
const encoder = new TextEncoder();

/**
 * A real 64x64 PNG, inlined so the edge test stays self-contained (sharp only
 * runs in the node project). T-API-03 needs bytes that survive the process
 * action, because dedupe deliberately ignores rows that failed validation.
 */
const VALID_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAA1BMVEUgYKAsHLN1AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAG0lEQVRYw+3BgQAAAADDoPlT3+AEVQEAAAB8AxBAAAEZszF2AAAAAElFTkSuQmCC",
  ),
  (char) => char.charCodeAt(0),
);

async function rejection(
  promise: Promise<unknown>,
): Promise<ConvexError<{ code: string; message: string }>> {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof ConvexError)) {
      throw error;
    }
    return error as ConvexError<{ code: string; message: string }>;
  }
  throw new Error("Expected the call to reject");
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function store(t: Test, bytes: Uint8Array<ArrayBuffer>): Promise<Id<"_storage">> {
  return t.run(async (ctx) => ctx.storage.store(new Blob([bytes])));
}

async function createAccount(t: Test, component: Component, email: string) {
  const now = Date.now();
  const user = await t.run(async (ctx) =>
    ctx.runMutation(component.adapter.create, {
      input: {
        model: "user",
        data: {
          name: email,
          email,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      },
    }),
  );
  const session = await t.run(async (ctx) =>
    ctx.runMutation(component.adapter.create, {
      input: {
        model: "session",
        data: {
          token: `token-${email}`,
          userId: user._id,
          expiresAt: now + 60_000,
          createdAt: now,
          updatedAt: now,
        },
      },
    }),
  );
  return {
    user,
    asUser: t.withIdentity({ subject: user._id, sessionId: session._id }),
  };
}

async function signedIn(t: Test, email = "ada@example.test") {
  const component = register(t, "betterAuth");
  return createAccount(t, component, email);
}

async function tables(t: Test) {
  return t.run(async (ctx) => ({
    images: await ctx.db.query("images").collect(),
    audits: await ctx.db.query("auditEvents").collect(),
    scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
  }));
}

async function storageExists(t: Test, storageId: Id<"_storage">) {
  return t.run(async (ctx) => (await ctx.db.system.get(storageId)) !== null);
}

it("T-API-01 requires auth and hands out a one-hour upload URL", async () => {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  const { asUser } = await signedIn(t);
  const probe = encoder.encode("anonymous probe");
  const storageId = await store(t, probe);
  const sha256 = await sha256Hex(probe);

  const anonymousUpload = await rejection(t.mutation(createUpload, {}));
  expect(anonymousUpload.data).toMatchObject({ code: "AUTH_REQUIRED" });

  const anonymousCommit = await rejection(
    t.mutation(commitUpload, {
      storageId,
      sha256,
      bytes: probe.length,
      mime: JPEG,
    }),
  );
  expect(anonymousCommit.data).toMatchObject({ code: "AUTH_REQUIRED" });

  const before = Date.now();
  const result = await asUser.mutation(createUpload, {});
  const after = Date.now();

  expect(typeof result.uploadUrl).toBe("string");
  expect(result.uploadUrl).toContain("/api/storage/upload");
  expect(result.expiresAt).toBeGreaterThanOrEqual(before + UPLOAD_URL_TTL_MS);
  expect(result.expiresAt).toBeLessThanOrEqual(after + UPLOAD_URL_TTL_MS);
});

it("T-API-02 commits one uploaded row, one audit row, and the process job", async () => {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerWorkpool(t, "scoringPool");
  const { user, asUser } = await signedIn(t);
  const bytes = encoder.encode("say cheese");
  const sha256 = await sha256Hex(bytes);
  const storageId = await store(t, bytes);

  const result = await asUser.mutation(commitUpload, {
    storageId,
    sha256,
    bytes: bytes.length,
    mime: JPEG,
  });

  expect(result.deduplicated).toBe(false);

  const { images, audits, scheduled } = await tables(t);
  expect(images).toHaveLength(1);
  expect(images[0]).toMatchObject({
    _id: result.id,
    userId: user._id,
    sha256,
    rawStorageId: storageId,
    mime: JPEG,
    bytes: bytes.length,
    status: "uploaded",
  });

  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    actorId: user._id,
    action: "image.commit",
    table: "images",
    docId: result.id,
    after: { sha256, bytes: bytes.length, mime: JPEG },
  });

  expect(scheduled).toHaveLength(1);
  expect(scheduled[0]).toMatchObject({
    name: "actions/images:process",
    args: [{ imageId: result.id }],
  });

  await t.finishAllScheduledFunctions(() => {});
  const finished = await tables(t);
  expect(finished.scheduled).toHaveLength(1);
  expect(finished.scheduled[0]).toMatchObject({ state: { kind: "success" } });
});

it("T-API-03 deduplicates per user and never duplicates rows or jobs", async () => {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerWorkpool(t, "scoringPool");
  const component = register(t, "betterAuth");
  const { user: userA, asUser: asA } = await createAccount(t, component, "a@example.test");
  const { asUser: asB } = await createAccount(t, component, "b@example.test");

  const bytes = VALID_PNG;
  const sha256 = await sha256Hex(bytes);

  const firstStorage = await store(t, bytes);
  const first = await asA.mutation(commitUpload, {
    storageId: firstStorage,
    sha256,
    bytes: bytes.length,
    mime: PNG,
  });
  await t.finishAllScheduledFunctions(() => {});

  const secondStorage = await store(t, bytes);
  const second = await asA.mutation(commitUpload, {
    storageId: secondStorage,
    sha256,
    bytes: bytes.length,
    mime: PNG,
  });

  expect(second).toEqual({ id: first.id, deduplicated: true });
  expect(await storageExists(t, secondStorage)).toBe(false);

  let counts = await tables(t);
  expect(counts.images).toHaveLength(1);
  expect(counts.audits).toHaveLength(1);
  expect(counts.scheduled).toHaveLength(1);
  expect(counts.images[0]).toMatchObject({ _id: first.id, userId: userA._id });

  const userBStorage = await store(t, bytes);
  const userB = await asB.mutation(commitUpload, {
    storageId: userBStorage,
    sha256,
    bytes: bytes.length,
    mime: PNG,
  });

  expect(userB.deduplicated).toBe(false);
  expect(userB.id).not.toBe(first.id);

  counts = await tables(t);
  expect(counts.images).toHaveLength(2);
  expect(counts.audits).toHaveLength(2);
  expect(counts.scheduled).toHaveLength(2);
});

it("rejects a declared sha256 that disagrees with storage without writing a row", async () => {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  const { asUser } = await signedIn(t);
  const bytes = encoder.encode("hash mismatch");
  const storageId = await store(t, bytes);

  const error = await rejection(
    asUser.mutation(commitUpload, {
      storageId,
      sha256: "1".repeat(64),
      bytes: bytes.length,
      mime: JPEG,
    }),
  );

  expect(error.data).toMatchObject({ code: "VALIDATION_FAILED" });
  const counts = await tables(t);
  expect(counts.images).toHaveLength(0);
  expect(counts.audits).toHaveLength(0);
  expect(counts.scheduled).toHaveLength(0);
});

it("rejects declared bytes that disagree with storage without writing a row", async () => {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  const { asUser } = await signedIn(t);
  const bytes = encoder.encode("size mismatch");
  const storageId = await store(t, bytes);
  const sha256 = await sha256Hex(bytes);

  const error = await rejection(
    asUser.mutation(commitUpload, {
      storageId,
      sha256,
      bytes: bytes.length + 1,
      mime: JPEG,
    }),
  );

  expect(error.data).toMatchObject({ code: "VALIDATION_FAILED" });
  expect((await tables(t)).images).toHaveLength(0);
});

it("rejects a declared HEIC upload with HEIC_UNSUPPORTED", async () => {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  const { asUser } = await signedIn(t);
  const bytes = encoder.encode("heic bytes");
  const storageId = await store(t, bytes);
  const sha256 = await sha256Hex(bytes);

  const heicMimes = [
    "image/heic",
    "image/heif",
    "image/heic-sequence",
    "image/heif-sequence",
  ];
  for (const mime of heicMimes) {
    const error = await rejection(
      asUser.mutation(commitUpload, {
        storageId,
        sha256,
        bytes: bytes.length,
        mime,
      }),
    );

    expect(error.data).toMatchObject({ code: "HEIC_UNSUPPORTED" });
  }
  expect((await tables(t)).images).toHaveLength(0);
});

it("rejects a MIME type outside the core allowlist", async () => {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  const { asUser } = await signedIn(t);
  const bytes = encoder.encode("gif bytes");
  const storageId = await store(t, bytes);
  const sha256 = await sha256Hex(bytes);

  const error = await rejection(
    asUser.mutation(commitUpload, {
      storageId,
      sha256,
      bytes: bytes.length,
      mime: "image/gif",
    }),
  );

  expect(error.data).toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
  expect((await tables(t)).images).toHaveLength(0);
});

it("rejects an unknown storage id with NOT_FOUND", async () => {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  const { asUser } = await signedIn(t);
  const bytes = encoder.encode("gone");
  const storageId = await store(t, bytes);
  const sha256 = await sha256Hex(bytes);
  await t.run(async (ctx) => ctx.storage.delete(storageId));

  const error = await rejection(
    asUser.mutation(commitUpload, {
      storageId,
      sha256,
      bytes: bytes.length,
      mime: JPEG,
    }),
  );

  expect(error.data).toMatchObject({ code: "NOT_FOUND" });
});

it("repeats a commit idempotently and rejects another user claiming the same object", async () => {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  const component = register(t, "betterAuth");
  const { asUser: asOwner } = await createAccount(t, component, "owner@example.test");
  const { asUser: asOther } = await createAccount(t, component, "other@example.test");
  const bytes = encoder.encode("reuse");
  const storageId = await store(t, bytes);
  const sha256 = await sha256Hex(bytes);
  const args = { storageId, sha256, bytes: bytes.length, mime: JPEG };

  const first = await asOwner.mutation(commitUpload, args);

  // The uploader retries the same storage id when a commit response is lost.
  const replay = await asOwner.mutation(commitUpload, args);
  expect(replay).toEqual({ id: first.id, deduplicated: false });
  expect(await storageExists(t, storageId)).toBe(true);
  expect((await tables(t)).images).toHaveLength(1);

  // Another account can never take over an object the first user owns.
  const error = await rejection(asOther.mutation(commitUpload, args));
  expect(error.data).toMatchObject({ code: "VALIDATION_FAILED" });
  expect(await storageExists(t, storageId)).toBe(true);
  expect((await tables(t)).images).toHaveLength(1);
});

it("rejects committing any processed variant owned by another image", async () => {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  const component = register(t, "betterAuth");
  const { user: victim } = await createAccount(t, component, "victim@example.test");
  const { user: attacker, asUser: asAttacker } = await createAccount(
    t,
    component,
    "attacker@example.test",
  );

  const mainBytes = encoder.encode("victim main");
  const previewBytes = encoder.encode("victim preview");
  const thumbBytes = encoder.encode("victim thumb");
  const mainId = await store(t, mainBytes);
  const previewId = await store(t, previewBytes);
  const thumbId = await store(t, thumbBytes);
  const previewSha = await sha256Hex(previewBytes);

  await t.run(async (ctx) =>
    ctx.db.insert("images", {
      userId: victim._id,
      sha256: previewSha,
      storageId: mainId,
      previewId,
      thumbId,
      mime: JPEG,
      bytes: mainBytes.length,
      status: "ready",
      createdAt: Date.now(),
    }),
  );

  // Without the reference check this row would trigger dedupe and the commit
  // would delete the victim's preview object.
  await t.run(async (ctx) =>
    ctx.db.insert("images", {
      userId: attacker._id,
      sha256: previewSha,
      mime: JPEG,
      bytes: previewBytes.length,
      status: "uploaded",
      createdAt: Date.now(),
    }),
  );

  const attempts: Array<[Id<"_storage">, Uint8Array<ArrayBuffer>]> = [
    [mainId, mainBytes],
    [previewId, previewBytes],
    [thumbId, thumbBytes],
  ];

  for (const [storageId, bytes] of attempts) {
    const sha256 = await sha256Hex(bytes);
    const error = await rejection(
      asAttacker.mutation(commitUpload, {
        storageId,
        sha256,
        bytes: bytes.length,
        mime: JPEG,
      }),
    );
    expect(error.data).toMatchObject({ code: "VALIDATION_FAILED" });
  }

  expect(await storageExists(t, mainId)).toBe(true);
  expect(await storageExists(t, previewId)).toBe(true);
  expect(await storageExists(t, thumbId)).toBe(true);
});

it("rejects an upload older than the URL lifetime plus grace", async () => {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  const { asUser } = await signedIn(t);
  const bytes = encoder.encode("stale upload");
  const sha256 = await sha256Hex(bytes);

  vi.useFakeTimers({ toFake: ["Date"] });
  let storageId: Id<"_storage">;
  try {
    vi.setSystemTime(
      Date.now() - UPLOAD_URL_TTL_MS - UPLOAD_COMMIT_GRACE_MS - 60_000,
    );
    storageId = await store(t, bytes);
  } finally {
    vi.useRealTimers();
  }

  const error = await rejection(
    asUser.mutation(commitUpload, {
      storageId,
      sha256,
      bytes: bytes.length,
      mime: JPEG,
    }),
  );

  expect(error.data).toMatchObject({ code: "UPLOAD_EXPIRED" });
  expect((await tables(t)).images).toHaveLength(0);
});

it("rejects an object over the byte cap", async () => {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  const { asUser } = await signedIn(t);
  const bytes = new Uint8Array(MAX_UPLOAD_BYTES + 1);
  const sha256 = await sha256Hex(bytes);
  const storageId = await store(t, bytes);

  const error = await rejection(
    asUser.mutation(commitUpload, {
      storageId,
      sha256,
      bytes: bytes.length,
      mime: JPEG,
    }),
  );

  expect(error.data).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  expect((await tables(t)).images).toHaveLength(0);
});