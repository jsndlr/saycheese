import { generateKeyPairSync } from "node:crypto";

import { mapProviderResult, VISION_JOY_SCORES } from "@saycheese/core/scoring";
import { afterEach, describe, expect, it, vi } from "vitest";

import { providerFor } from "../convex/lib/providers";
import { ProviderError } from "../convex/lib/providers/types";
import {
  buildVisionJwt,
  classifyVisionFailure,
  createVisionProvider,
  toProviderResult,
  VISION_ACCEPTED_MIMES,
  VISION_COST_MICROS_PER_IMAGE,
  VISION_MODEL,
  VISION_SCOPE,
  type VisionCredentials,
  type VisionFaceAnnotation,
} from "../convex/lib/providers/vision";

/**
 * Vision FACE_DETECTION mapping and transport (plan 6.1). Fixtures are hand
 * built in the annotation shape Cloud Vision returns; no network or Google
 * credentials are involved.
 */

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

let accountCounter = 0;

function credentials(): VisionCredentials {
  accountCounter += 1;
  return {
    clientEmail: `vision-test-${accountCounter}@example.iam.gserviceaccount.com`,
    privateKey,
  };
}

function annotation(
  joyLikelihood: string,
  options: { confidence?: number; x?: number; y?: number; size?: number } = {},
): VisionFaceAnnotation {
  const { confidence = 0.99, x = 0, y = 0, size = 100 } = options;
  return {
    detectionConfidence: confidence,
    joyLikelihood,
    boundingPoly: {
      vertices: [
        { x, y },
        { x: x + size, y },
        { x: x + size, y: y + size },
        { x, y: y + size },
      ],
    },
  };
}

function mapped(annotations: readonly VisionFaceAnnotation[]) {
  const result = toProviderResult(annotations);
  return mapProviderResult(
    { ...result, latencyMs: 1, costMicros: VISION_COST_MICROS_PER_IMAGE },
    {
      provider: "vision",
      providerModel: VISION_MODEL,
      cached: false,
      joyLikelihood: result.joyLikelihood ?? "",
    },
  );
}

const input = (signal?: AbortSignal) => ({
  bytes: new Uint8Array([1, 2, 3]),
  mime: "image/webp",
  sha256: "0".repeat(64),
  signal,
});

function urlOf(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** Fake transport: token endpoint plus annotate endpoint, counted separately. */
function stubVisionFetch(annotate: () => Response) {
  let tokenRequests = 0;
  let annotateRequests = 0;
  const annotateBodies: unknown[] = [];
  const annotateInit: RequestInit[] = [];

  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = urlOf(input);
      if (url.includes("oauth2.googleapis.com")) {
        tokenRequests += 1;
        return new Response(
          JSON.stringify({ access_token: `token-${tokenRequests}`, expires_in: 3600 }),
          { status: 200 },
        );
      }
      annotateRequests += 1;
      annotateInit.push(init ?? {});
      if (init?.body !== undefined && typeof init.body === "string") {
        annotateBodies.push(JSON.parse(init.body));
      }
      if (init?.signal?.aborted) {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        throw error;
      }
      return annotate();
    },
  );

  return {
    tokenRequests: () => tokenRequests,
    annotateRequests: () => annotateRequests,
    annotateBodies,
    annotateInit,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Vision FACE_DETECTION mapping", () => {
  it.each([
    ["VERY_LIKELY", 90],
    ["LIKELY", 75],
    ["POSSIBLE", 50],
    ["UNLIKELY", 25],
    ["VERY_UNLIKELY", 10],
  ])("maps %s to %i", (likelihood, score) => {
    expect(VISION_JOY_SCORES[likelihood as keyof typeof VISION_JOY_SCORES]).toBe(score);
    expect(mapped([annotation(likelihood)])).toMatchObject({
      status: "scored",
      score,
      provider: "vision",
      faceCount: 1,
    });
  });

  it("maps UNKNOWN to low_quality instead of inventing a score", () => {
    expect(mapped([annotation("UNKNOWN")])).toMatchObject({
      status: "low_quality",
      score: null,
    });
  });

  it("scores the largest box when two faces are present", () => {
    const result = toProviderResult([
      annotation("POSSIBLE", { size: 40, confidence: 0.95 }),
      annotation("VERY_LIKELY", { x: 200, y: 200, size: 180, confidence: 0.97 }),
    ]);

    expect(result.faces).toHaveLength(2);
    expect(result.joyLikelihood).toBe("VERY_LIKELY");
    expect(result.faces[0]?.area).toBe(1600);
    expect(result.faces[1]?.area).toBe(32_400);

    const score = mapped([
      annotation("POSSIBLE", { size: 40, confidence: 0.95 }),
      annotation("VERY_LIKELY", { x: 200, y: 200, size: 180, confidence: 0.97 }),
    ]);
    expect(score).toMatchObject({ status: "multiple_faces", score: 90, faceCount: 2 });
  });

  it("reports no_face for zero faces", () => {
    expect(mapped([])).toMatchObject({ status: "no_face", score: null, faceCount: 0 });
  });

  it("scales detectionConfidence from 0..1 to core's 0..100", () => {
    const result = toProviderResult([annotation("LIKELY", { confidence: 0.87 })]);

    expect(result.faces[0]?.faceConfidence).toBeCloseTo(87);
    expect(mapped([annotation("LIKELY", { confidence: 0.87 })]).confidence).toBeCloseTo(0.87);
  });

  it("leaves sharpness undefined without treating it as low quality", () => {
    const result = toProviderResult([annotation("VERY_LIKELY")]);

    expect(result.faces[0]?.sharpness).toBeUndefined();
    expect(mapped([annotation("VERY_LIKELY")])).toMatchObject({
      status: "scored",
      score: 90,
    });
  });
});

describe("Vision failure classification", () => {
  const cases: {
    label: string;
    input: Parameters<typeof classifyVisionFailure>[0];
    kind: "retryable" | "fatal";
    code: string;
  }[] = [
    {
      label: "HTTP 429",
      input: { httpStatus: 429 },
      kind: "retryable",
      code: "throttled",
    },
    {
      label: "RESOURCE_EXHAUSTED",
      input: { status: "RESOURCE_EXHAUSTED" },
      kind: "retryable",
      code: "throttled",
    },
    {
      label: "HTTP 500",
      input: { httpStatus: 500 },
      kind: "retryable",
      code: "server_error",
    },
    {
      label: "UNAVAILABLE",
      input: { status: "UNAVAILABLE" },
      kind: "retryable",
      code: "server_error",
    },
    {
      label: "INTERNAL",
      input: { status: "INTERNAL" },
      kind: "retryable",
      code: "server_error",
    },
    {
      label: "DEADLINE_EXCEEDED",
      input: { status: "DEADLINE_EXCEEDED" },
      kind: "retryable",
      code: "timeout",
    },
    {
      label: "HTTP 400",
      input: { httpStatus: 400 },
      kind: "fatal",
      code: "invalid_argument",
    },
    {
      label: "INVALID_ARGUMENT",
      input: { status: "INVALID_ARGUMENT" },
      kind: "fatal",
      code: "invalid_argument",
    },
    {
      label: "HTTP 401",
      input: { httpStatus: 401 },
      kind: "fatal",
      code: "permission_denied",
    },
    {
      label: "HTTP 403",
      input: { httpStatus: 403 },
      kind: "fatal",
      code: "permission_denied",
    },
    {
      label: "PERMISSION_DENIED",
      input: { status: "PERMISSION_DENIED" },
      kind: "fatal",
      code: "permission_denied",
    },
    {
      label: "UNAUTHENTICATED",
      input: { status: "UNAUTHENTICATED" },
      kind: "fatal",
      code: "permission_denied",
    },
    {
      label: "unknown status",
      input: { httpStatus: 418 },
      kind: "fatal",
      code: "unexpected_error",
    },
  ];

  it.each(cases)("$label -> $kind/$code", ({ input, kind, code }) => {
    const classified = classifyVisionFailure(input);

    expect(classified).toBeInstanceOf(ProviderError);
    expect(classified.kind).toBe(kind);
    expect(classified.code).toBe(code);
  });
});

describe("Vision service account JWT", () => {
  it("carries the RS256 header and the required claims", async () => {
    const issuedAt = 1_700_000_000_000;
    const token = await buildVisionJwt(credentials(), issuedAt);
    const [encodedHeader, encodedClaims, signature] = token.split(".");

    expect(signature?.length).toBeGreaterThan(0);
    const header = JSON.parse(Buffer.from(encodedHeader ?? "", "base64url").toString());
    const claims = JSON.parse(Buffer.from(encodedClaims ?? "", "base64url").toString());

    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(claims).toEqual({
      iss: expect.stringContaining("@example.iam.gserviceaccount.com"),
      scope: VISION_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: issuedAt / 1000,
      exp: issuedAt / 1000 + 3600,
    });
  });

  it("honours service-account token_uri and rejects an unusable key", async () => {
    const token = await buildVisionJwt(
      { ...credentials(), tokenUri: "https://example.test/token" },
      1_700_000_000_000,
    );
    const claims = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString(),
    );
    expect(claims.aud).toBe("https://example.test/token");

    await expect(
      buildVisionJwt({ ...credentials(), privateKey: "not-a-key" }),
    ).rejects.toMatchObject({ kind: "fatal", code: "invalid_credentials" });
  });
});

describe("Vision images:annotate request", () => {
  it("calls FACE_DETECTION with a bearer token and maps the annotation", async () => {
    const transport = stubVisionFetch(
      () =>
        new Response(
          JSON.stringify({ responses: [{ faceAnnotations: [annotation("VERY_LIKELY")] }] }),
          { status: 200 },
        ),
    );

    const provider = createVisionProvider(credentials());
    const result = await provider.score(input());

    expect(provider.model).toBe(VISION_MODEL);
    expect(provider.acceptedMimes).toEqual(VISION_ACCEPTED_MIMES);
    expect(result).toMatchObject({
      joyLikelihood: "VERY_LIKELY",
      costMicros: VISION_COST_MICROS_PER_IMAGE,
    });
    expect(result.faces).toHaveLength(1);
    expect(transport.annotateRequests()).toBe(1);

    const init = transport.annotateInit[0];
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer token-1");
    expect(transport.annotateBodies[0]).toEqual({
      requests: [
        {
          image: { content: "AQID" },
          features: [{ type: "FACE_DETECTION", maxResults: 10 }],
        },
      ],
    });
  });

  it("caches the access token across calls and refreshes it before expiry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const transport = stubVisionFetch(
      () =>
        new Response(
          JSON.stringify({ responses: [{ faceAnnotations: [annotation("LIKELY")] }] }),
          { status: 200 },
        ),
    );

    const provider = createVisionProvider(credentials());
    await provider.score(input());
    await provider.score(input());
    expect(transport.tokenRequests()).toBe(1);

    // 100 s before expiry: still cached.
    vi.setSystemTime(Date.now() + 3_500_000);
    await provider.score(input());
    expect(transport.tokenRequests()).toBe(1);

    // Inside the 60 s safety window: a new token is exchanged.
    vi.setSystemTime(Date.now() + 200_000);
    await provider.score(input());
    expect(transport.tokenRequests()).toBe(2);
  });

  const perImageCases = [
    { code: 4, kind: "retryable" as const, errorCode: "timeout" }, // DEADLINE_EXCEEDED
    { code: 8, kind: "retryable" as const, errorCode: "throttled" }, // RESOURCE_EXHAUSTED
    { code: 13, kind: "retryable" as const, errorCode: "server_error" }, // INTERNAL
    { code: 14, kind: "retryable" as const, errorCode: "server_error" }, // UNAVAILABLE
    { code: 3, kind: "fatal" as const, errorCode: "invalid_argument" }, // INVALID_ARGUMENT
    { code: 7, kind: "fatal" as const, errorCode: "permission_denied" }, // PERMISSION_DENIED
  ];

  it.each(perImageCases)(
    "maps a per-image google.rpc.Status code $code to $kind/$errorCode",
    async ({ code, kind, errorCode }) => {
      stubVisionFetch(
        () =>
          new Response(
            JSON.stringify({
              responses: [
                {
                  error: {
                    code,
                    message: "per-image failure",
                    details: [],
                  },
                },
              ],
            }),
            { status: 200 },
          ),
      );

      await expect(createVisionProvider(credentials()).score(input())).rejects.toMatchObject({
        kind,
        code: errorCode,
      });
    },
  );

  it("classifies a non-200 HTTP body by its string status", async () => {
    stubVisionFetch(
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: 429,
              message: "quota",
              status: "RESOURCE_EXHAUSTED",
            },
          }),
          { status: 429 },
        ),
    );

    await expect(createVisionProvider(credentials()).score(input())).rejects.toMatchObject({
      kind: "retryable",
      code: "throttled",
    });
  });

  it("classifies a network failure on annotate as retryable", async () => {
    const credentialsValue = credentials();
    let calls = 0;
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      calls += 1;
      if (urlOf(input).includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }));
      }
      throw new TypeError("fetch failed");
    });

    await expect(createVisionProvider(credentialsValue).score(input())).rejects.toMatchObject({
      kind: "retryable",
      code: "network_error",
    });
    expect(calls).toBe(2);
  });

  it("classifies an abort as retryable", async () => {
    const credentialsValue = credentials();
    const transport = stubVisionFetch(
      () => new Response(JSON.stringify({ responses: [] }), { status: 200 }),
    );
    // Prime the token cache, then abort the annotate call.
    await createVisionProvider(credentialsValue).score(input());

    const controller = new AbortController();
    controller.abort();
    await expect(
      createVisionProvider(credentialsValue).score(input(controller.signal)),
    ).rejects.toMatchObject({ kind: "retryable", code: "timeout" });
    expect(transport.tokenRequests()).toBe(1);
  });

  it("treats token exchange failures as fatal", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 401 }),
    );

    await expect(createVisionProvider(credentials()).score(input())).rejects.toMatchObject({
      kind: "fatal",
      code: "token_exchange_failed",
    });
  });
});

function caught(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("providerFor vision", () => {
  const serviceAccount = JSON.stringify({
    client_email: "vision@example.iam.gserviceaccount.com",
    private_key: privateKey,
  });

  it("builds the adapter from GOOGLE_APPLICATION_CREDENTIALS_JSON", () => {
    const provider = providerFor("vision", {
      SMILE_PROVIDER: "vision",
      GOOGLE_APPLICATION_CREDENTIALS_JSON: serviceAccount,
    });

    expect(provider.name).toBe("vision");
    expect(provider.model).toBe(VISION_MODEL);
  });

  it("fails fatally when credentials are absent or malformed", () => {
    expect(caught(() => providerFor("vision", { SMILE_PROVIDER: "vision" }))).toMatchObject({
      kind: "fatal",
      code: "missing_credentials",
    });
    expect(
      caught(() =>
        providerFor("vision", {
          SMILE_PROVIDER: "vision",
          GOOGLE_APPLICATION_CREDENTIALS_JSON: "not-json",
        }),
      ),
    ).toMatchObject({ kind: "fatal", code: "invalid_credentials" });
    expect(
      caught(() =>
        providerFor("vision", {
          SMILE_PROVIDER: "vision",
          GOOGLE_APPLICATION_CREDENTIALS_JSON: JSON.stringify({ client_email: "a@b" }),
        }),
      ),
    ).toMatchObject({ kind: "fatal", code: "invalid_credentials" });
  });
});