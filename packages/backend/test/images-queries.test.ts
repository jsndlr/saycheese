import type { ComponentApi } from "@convex-dev/better-auth/_generated/component.js";
import { register } from "@convex-dev/better-auth/test";
import { convexTest } from "convex-test";
import type { TestConvex } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { expect, it } from "vitest";

import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import type { ImageDto } from "../convex/model/images";

const modules = import.meta.glob("../convex/**/*.ts");

type Test = TestConvex<typeof schema>;
type Component = ComponentApi;

type PaginationOpts = { numItems: number; cursor: string | null };
type Page = { page: ImageDto[]; isDone: boolean; continueCursor: string };

const list = makeFunctionReference<"query", { paginationOpts: PaginationOpts }, Page>(
  "queries/images:list",
);
const byId = makeFunctionReference<"query", { id: string }, ImageDto>(
  "queries/images:byId",
);
const fileUrl = makeFunctionReference<
  "query",
  { id: string; variant: "original" | "preview" | "thumb" },
  { url: string | null }
>("queries/images:fileUrl");

const JPEG = "image/jpeg";
const encoder = new TextEncoder();

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

async function store(t: Test, text: string): Promise<Id<"_storage">> {
  return t.run(async (ctx) =>
    ctx.storage.store(new Blob([encoder.encode(text)])),
  );
}

async function insertImage(
  t: Test,
  fields: {
    userId: string;
    createdAt: number;
    archivedAt?: number;
    sha256?: string;
    status?: "uploaded" | "ready";
  },
): Promise<Id<"images">> {
  return t.run(async (ctx) =>
    ctx.db.insert("images", {
      userId: fields.userId,
      sha256: fields.sha256 ?? "0".repeat(64),
      mime: JPEG,
      bytes: 128,
      status: fields.status ?? "ready",
      createdAt: fields.createdAt,
      ...(fields.archivedAt === undefined
        ? {}
        : { archivedAt: fields.archivedAt }),
    }),
  );
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, keys);
    }
  } else if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}

it("T-API-04 lists only the caller's live images, newest first, across pages", async () => {
  const t = convexTest(schema, modules);
  const component = register(t, "betterAuth");
  const { user: owner, asUser: asOwner } = await createAccount(
    t,
    component,
    "owner@example.test",
  );
  const { user: foreign } = await createAccount(
    t,
    component,
    "foreign@example.test",
  );

  const base = Date.now() - 1_000_000;
  const live = await t.run(async (ctx) => {
    const ids: Id<"images">[] = [];
    for (let index = 0; index < 55; index += 1) {
      ids.push(
        await ctx.db.insert("images", {
          userId: owner._id,
          sha256: index.toString(16).padStart(64, "0"),
          mime: JPEG,
          bytes: 100 + index,
          status: "ready",
          createdAt: base + index,
        }),
      );
    }
    return ids;
  });

  await insertImage(t, { userId: owner._id, createdAt: base + 9000, archivedAt: base + 9500 });
  await insertImage(t, { userId: foreign._id, createdAt: base + 10_000 });

  const pages: Page[] = [];
  let cursor: string | null = null;
  do {
    const page: Page = await asOwner.query(list, {
      paginationOpts: { numItems: 25, cursor },
    });
    pages.push(page);
    cursor = page.isDone ? null : page.continueCursor;
  } while (cursor !== null);

  expect(pages.map((page) => page.page.length)).toEqual([25, 25, 5]);
  expect(pages.map((page) => page.isDone)).toEqual([false, false, true]);

  const received = pages.flatMap((page) => page.page.map((image) => image.id));
  expect(new Set(received).size).toBe(55);
  expect(received).toEqual([...live].reverse());
});

it("preserves every pagination metadata field returned by paginate", async () => {
  const t = convexTest(schema, modules);
  const { user, asUser } = await signedIn(t);
  for (let index = 0; index < 3; index += 1) {
    await insertImage(t, { userId: user._id, createdAt: index + 1 });
  }

  const raw = await t.run(async (ctx) =>
    ctx.db
      .query("images")
      .withIndex("by_user_live_created", (q) =>
        q.eq("userId", user._id).eq("archivedAt", undefined),
      )
      .order("desc")
      .paginate({ numItems: 2, cursor: null }),
  );
  const result = await asUser.query(list, {
    paginationOpts: { numItems: 2, cursor: null },
  });

  expect(Object.keys(result).sort()).toEqual(Object.keys(raw).sort());
  expect(
    Object.fromEntries(Object.entries(result).filter(([key]) => key !== "page")),
  ).toEqual(
    Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "page")),
  );
  expect(result.page).toHaveLength(2);
});

it("matches live rows through the index equality on the missing archivedAt field", async () => {
  const t = convexTest(schema, modules);
  const component = register(t, "betterAuth");
  const { user } = await createAccount(t, component, "index@example.test");

  await insertImage(t, { userId: user._id, createdAt: 2 });
  await insertImage(t, { userId: user._id, createdAt: 1 });
  await insertImage(t, { userId: user._id, createdAt: 3, archivedAt: 4 });

  const rows = await t.run(async (ctx) =>
    ctx.db
      .query("images")
      .withIndex("by_user_live_created", (q) =>
        q.eq("userId", user._id).eq("archivedAt", undefined),
      )
      .order("desc")
      .collect(),
  );

  expect(rows.map((row) => row.createdAt)).toEqual([2, 1]);
});

it("T-API-05 hides foreign, deleted and archived ids behind one NOT_FOUND payload", async () => {
  const t = convexTest(schema, modules);
  const component = register(t, "betterAuth");
  const { user: owner, asUser: asOwner } = await createAccount(
    t,
    component,
    "owner@example.test",
  );
  const { user: foreign } = await createAccount(
    t,
    component,
    "foreign@example.test",
  );

  const liveId = await insertImage(t, { userId: owner._id, createdAt: 1 });
  const archivedId = await insertImage(t, {
    userId: owner._id,
    createdAt: 2,
    archivedAt: 3,
  });
  const foreignId = await insertImage(t, { userId: foreign._id, createdAt: 4 });
  const deletedId = await insertImage(t, { userId: owner._id, createdAt: 5 });
  await t.run(async (ctx) => ctx.db.delete("images", deletedId));

  const reference = await rejection(asOwner.query(byId, { id: foreignId }));
  expect(reference.data).toMatchObject({ code: "NOT_FOUND" });

  for (const id of [archivedId, deletedId, foreignId]) {
    const viaById = await rejection(asOwner.query(byId, { id }));
    const viaUrl = await rejection(
      asOwner.query(fileUrl, { id, variant: "original" }),
    );
    expect(viaById.data).toEqual(reference.data);
    expect(viaUrl.data).toEqual(reference.data);
  }

  await expect(asOwner.query(byId, { id: liveId })).resolves.toMatchObject({
    id: liveId,
  });

  const anonymousList = await rejection(
    t.query(list, { paginationOpts: { numItems: 10, cursor: null } }),
  );
  const anonymousById = await rejection(t.query(byId, { id: liveId }));
  const anonymousUrl = await rejection(
    t.query(fileUrl, { id: liveId, variant: "thumb" }),
  );
  for (const error of [anonymousList, anonymousById, anonymousUrl]) {
    expect(error.data).toMatchObject({ code: "AUTH_REQUIRED" });
  }
});

it("T-API-05b answers a malformed or unknown id with NOT_FOUND, not a validator error", async () => {
  const t = convexTest(schema, modules);
  const { asUser } = await signedIn(t);

  // A validator rejection happens before the handler and its message is not
  // part of the production response, so these ids must reach the handler.
  for (const id of ["nonsense", "j0000000000000000000000000000000", ""]) {
    const viaById = await rejection(asUser.query(byId, { id }));
    const viaUrl = await rejection(
      asUser.query(fileUrl, { id, variant: "original" }),
    );
    expect(viaById.data).toMatchObject({ code: "NOT_FOUND" });
    expect(viaUrl.data).toEqual(viaById.data);
  }
});

it("never leaks storage ids, ownership or provider internals in DTOs", async () => {
  const t = convexTest(schema, modules);
  const { user, asUser } = await signedIn(t);

  const raw = await store(t, "raw image");
  const original = await store(t, "original image");
  const preview = await store(t, "preview image");
  const thumb = await store(t, "thumb image");

  const imageId = await t.run(async (ctx) => {
    const scoreId = await ctx.db.insert("scores", {
      sha256: "a".repeat(64),
      score: 87,
      confidence: 0.9,
      faceCount: 1,
      status: "scored",
      reason: "one clear face",
      provider: "stub",
      providerModel: "stub-model",
      configVersion: "v1",
      latencyMs: 12,
      costMicros: 99,
      detail: { secret: "provider payload" },
      cacheable: true,
      createdAt: 1,
    });
    return ctx.db.insert("images", {
      userId: user._id,
      sha256: "b".repeat(64),
      rawStorageId: raw,
      storageId: original,
      previewId: preview,
      thumbId: thumb,
      mime: JPEG,
      bytes: 512,
      width: 640,
      height: 480,
      status: "scored",
      scoreId,
      createdAt: 2,
    });
  });

  const detail = await asUser.query(byId, { id: imageId });
  const page = await asUser.query(list, {
    paginationOpts: { numItems: 10, cursor: null },
  });

  const forbiddenKeys = [
    "userId",
    "rawStorageId",
    "storageId",
    "previewId",
    "thumbId",
    "detail",
    "providerModel",
    "costMicros",
  ];
  const keys = new Set([
    ...collectKeys(detail),
    ...collectKeys(page.page),
  ]);
  expect(keys.size).toBeGreaterThan(0);
  expect([...keys].filter((key) => forbiddenKeys.includes(key))).toEqual([]);

  const serialized = JSON.stringify({ detail, page });
  for (const storageId of [raw, original, preview, thumb]) {
    expect(serialized).not.toContain(storageId);
  }

  expect(Object.keys(detail).sort()).toEqual([
    "bytes",
    "createdAt",
    "failureCode",
    "height",
    "id",
    "mime",
    "quotaExceeded",
    "score",
    "sha256",
    "status",
    "width",
  ]);
});

it("returns URLs for every processed variant and null before processing", async () => {
  const t = convexTest(schema, modules);
  const { user, asUser } = await signedIn(t);

  const raw = await store(t, "raw");
  const original = await store(t, "original");
  const preview = await store(t, "preview");
  const thumb = await store(t, "thumb");

  const readyId = await t.run(async (ctx) =>
    ctx.db.insert("images", {
      userId: user._id,
      sha256: "c".repeat(64),
      rawStorageId: raw,
      storageId: original,
      previewId: preview,
      thumbId: thumb,
      mime: JPEG,
      bytes: 400,
      width: 800,
      height: 600,
      status: "ready",
      createdAt: 2,
    }),
  );
  const uploadedId = await t.run(async (ctx) =>
    ctx.db.insert("images", {
      userId: user._id,
      sha256: "d".repeat(64),
      rawStorageId: raw,
      mime: JPEG,
      bytes: 400,
      status: "uploaded",
      createdAt: 1,
    }),
  );

  for (const [variant, storageId] of [
    ["original", original],
    ["preview", preview],
    ["thumb", thumb],
  ] as const) {
    const { url } = await asUser.query(fileUrl, { id: readyId, variant });
    expect(typeof url).toBe("string");
    expect(url).not.toBe("");
    expect(url).not.toBe(storageId);
  }

  for (const variant of ["original", "preview", "thumb"] as const) {
    await expect(
      asUser.query(fileUrl, { id: uploadedId, variant }),
    ).resolves.toEqual({ url: null });
  }
});

it("T-SEC-03 exposes a failed row and its code without storage ids", async () => {
  const t = convexTest(schema, modules);
  const { user, asUser } = await signedIn(t);
  const raw = await store(t, "failed raw");

  // Same shape as the seeded IMAGE_CORRUPT image: readable after the failure.
  const imageId = await t.run(async (ctx) =>
    ctx.db.insert("images", {
      userId: user._id,
      sha256: "f".repeat(64),
      rawStorageId: raw,
      mime: JPEG,
      bytes: 128,
      width: 800,
      height: 600,
      status: "failed",
      failureCode: "IMAGE_CORRUPT",
      createdAt: 5,
    }),
  );

  const detail = await asUser.query(byId, { id: imageId });
  expect(detail).toMatchObject({
    id: imageId,
    status: "failed",
    failureCode: "IMAGE_CORRUPT",
  });

  const page = await asUser.query(list, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  const listed = page.page.find((image) => image.id === imageId);
  expect(listed).toMatchObject({
    status: "failed",
    failureCode: "IMAGE_CORRUPT",
  });

  const keys = collectKeys({ detail, page });
  for (const key of ["rawStorageId", "storageId", "previewId", "thumbId"]) {
    expect(keys.has(key)).toBe(false);
  }
  expect(JSON.stringify({ detail, page })).not.toContain(raw);
});

it("joins the score row into the DTO and returns null without one", async () => {
  const t = convexTest(schema, modules);
  const { user, asUser } = await signedIn(t);

  const scoredId = await t.run(async (ctx) => {
    const scoreId = await ctx.db.insert("scores", {
      sha256: "e".repeat(64),
      score: 91.5,
      confidence: 0.88,
      faceCount: 1,
      status: "scored",
      reason: "clear face",
      provider: "vision",
      providerModel: "vision-1",
      configVersion: "v2",
      latencyMs: 41,
      cacheable: true,
      createdAt: 10,
    });
    return ctx.db.insert("images", {
      userId: user._id,
      sha256: "e".repeat(64),
      mime: JPEG,
      bytes: 64,
      status: "scored",
      scoreId,
      createdAt: 11,
    });
  });
  const unscoredId = await insertImage(t, {
    userId: user._id,
    createdAt: 12,
  });

  await expect(asUser.query(byId, { id: scoredId })).resolves.toMatchObject({
    score: {
      score: 91.5,
      confidence: 0.88,
      faceCount: 1,
      status: "scored",
      reason: "clear face",
      provider: "vision",
      createdAt: 10,
    },
  });
  await expect(asUser.query(byId, { id: unscoredId })).resolves.toMatchObject({
    score: null,
  });
});