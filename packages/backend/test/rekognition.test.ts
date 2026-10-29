import { readFileSync } from "node:fs";
import { mapProviderResult, type ProviderResult } from "@saycheese/core/scoring";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyRekognitionError,
  createRekognitionProvider,
  REKOGNITION_COST_MICROS_PER_IMAGE,
  REKOGNITION_MODEL,
  toProviderFaces,
  type DetectFacesResponse,
  type RekognitionErrorLike,
} from "../convex/lib/providers/rekognition";
import { providerFor } from "../convex/lib/providers";
import { ProviderError } from "../convex/lib/providers/types";

/**
 * Rekognition `DetectFaces` mapping (plan 6.1). Fixtures are hand-written
 * recorded-shape responses; no network or credentials are involved.
 */

function response(name: string): DetectFacesResponse {
  const raw = readFileSync(
    new URL(`./fixtures/rekognition/${name}.json`, import.meta.url),
    "utf8",
  );
  return JSON.parse(raw) as DetectFacesResponse;
}

function result(name: string): ProviderResult {
  return {
    faces: toProviderFaces(response(name).FaceDetails ?? []),
    latencyMs: 12,
    costMicros: REKOGNITION_COST_MICROS_PER_IMAGE,
  };
}

function mapped(name: string) {
  return mapProviderResult(result(name), {
    provider: "rekognition",
    providerModel: REKOGNITION_MODEL,
    cached: false,
  });
}

describe("Rekognition face mapping", () => {
  it("scores a smiling face from Smile.Value and Smile.Confidence", () => {
    expect(mapped("smiling")).toMatchObject({
      status: "scored",
      score: 92,
      confidence: 0.998,
      faceCount: 1,
      provider: "rekognition",
      providerModel: "rekognition-detectfaces",
      latencyMs: 12,
      cached: false,
    });
  });

  it("scores a confident non-smile as 100 - Confidence (Phase 0 P1)", () => {
    // Value false, Confidence 99 must be 1, not 99: the Phase 0 P1 regression.
    const score = mapped("non-smiling");
    expect(score).toMatchObject({
      status: "scored",
      score: 1,
      faceCount: 1,
    });
    expect(score.confidence).toBeCloseTo(0.999, 10);
  });

  it("scores the largest bounding box when several faces are present", () => {
    // Small face: 0.1 * 0.1 = 0.01, smiling 98. Large face: 0.6 * 0.5 = 0.3,
    // smiling 60. The large face must win despite the lower smile.
    expect(mapped("two-faces")).toMatchObject({
      status: "multiple_faces",
      score: 60,
      confidence: 0.996,
      faceCount: 2,
    });
  });

  it("rejects a sharpness below MIN_SHARPNESS as low_quality", () => {
    expect(mapped("low-sharpness")).toMatchObject({
      status: "low_quality",
      score: null,
      faceCount: 1,
    });
  });

  it("reports no_face when DetectFaces returns no FaceDetails", () => {
    expect(mapped("no-faces")).toMatchObject({
      status: "no_face",
      score: null,
      confidence: null,
      faceCount: 0,
    });
  });

  it("maps a missing Smile or Quality field without inventing values", () => {
    expect(toProviderFaces([{ Confidence: 99, BoundingBox: { Width: 0.5 } }])).toEqual([
      {
        area: 0,
        smileConfidence: 0,
        smileValue: null,
        faceConfidence: 99,
        sharpness: null,
      },
    ]);
  });
});

describe("Rekognition error classification", () => {
  const cases: {
    label: string;
    error: RekognitionErrorLike;
    kind: "retryable" | "fatal";
    code: string;
  }[] = [
    {
      label: "ThrottlingException",
      error: { name: "ThrottlingException", $metadata: { httpStatusCode: 400 } },
      kind: "retryable",
      code: "throttled",
    },
    {
      label: "ProvisionedThroughputExceededException",
      error: {
        name: "ProvisionedThroughputExceededException",
        $metadata: { httpStatusCode: 400 },
      },
      kind: "retryable",
      code: "throttled",
    },
    {
      label: "InternalServerError",
      error: { name: "InternalServerError", $metadata: { httpStatusCode: 500 } },
      kind: "retryable",
      code: "server_error",
    },
    {
      label: "any 5xx status",
      error: { name: "ServiceUnavailable", $metadata: { httpStatusCode: 503 } },
      kind: "retryable",
      code: "server_error",
    },
    {
      label: "network failure",
      error: { name: "TypeError", message: "fetch failed" },
      kind: "retryable",
      code: "network_error",
    },
    {
      label: "timeout",
      error: { name: "AbortError" },
      kind: "retryable",
      code: "timeout",
    },
    {
      label: "InvalidImageFormatException",
      error: { name: "InvalidImageFormatException", $metadata: { httpStatusCode: 400 } },
      kind: "fatal",
      code: "invalid_image",
    },
    {
      label: "ImageTooLargeException",
      error: { name: "ImageTooLargeException", $metadata: { httpStatusCode: 400 } },
      kind: "fatal",
      code: "image_too_large",
    },
    {
      label: "InvalidParameterException",
      error: { name: "InvalidParameterException", $metadata: { httpStatusCode: 400 } },
      kind: "fatal",
      code: "invalid_parameter",
    },
    {
      label: "AccessDeniedException",
      error: { name: "AccessDeniedException", $metadata: { httpStatusCode: 400 } },
      kind: "fatal",
      code: "access_denied",
    },
    {
      label: "UnrecognizedClientException",
      error: { name: "UnrecognizedClientException", $metadata: { httpStatusCode: 403 } },
      kind: "fatal",
      code: "invalid_credentials",
    },
    {
      label: "InvalidSignatureException",
      error: { name: "InvalidSignatureException", $metadata: { httpStatusCode: 403 } },
      kind: "fatal",
      code: "invalid_credentials",
    },
    {
      label: "namespaced AWS error name",
      error: {
        name: "com.amazonaws.rekognition#InvalidParameterException",
        $metadata: { httpStatusCode: 400 },
      },
      kind: "fatal",
      code: "invalid_parameter",
    },
    {
      label: "unknown error",
      error: { name: "SomethingNewException", $metadata: { httpStatusCode: 418 } },
      kind: "fatal",
      code: "unexpected_error",
    },
  ];

  it.each(cases)("$label -> $kind/$code", ({ error, kind, code }) => {
    const classified = classifyRekognitionError(error);

    expect(classified).toBeInstanceOf(ProviderError);
    expect(classified.kind).toBe(kind);
    expect(classified.code).toBe(code);
  });
});

describe("providerFor", () => {
  it("returns the Rekognition adapter from AWS env", () => {
    const provider = providerFor("rekognition", {
      SMILE_PROVIDER: "rekognition",
      AWS_REGION: "eu-central-1",
      AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
      AWS_SECRET_ACCESS_KEY: "not-a-real-secret",
    });

    expect(provider.name).toBe("rekognition");
    expect(provider.model).toBe(REKOGNITION_MODEL);
  });

  it("fails fast when AWS credentials are absent", () => {
    expect(() => providerFor("rekognition", { SMILE_PROVIDER: "rekognition" })).toThrow(
      /AWS_REGION, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY/,
    );
  });
});

describe("Rekognition HTTP request", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function provider() {
    return createRekognitionProvider({
      region: "eu-central-1",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "not-a-real-secret",
    });
  }

  const input = (signal?: AbortSignal) => ({
    bytes: new Uint8Array([0xff, 0xd8, 0xff]),
    mime: "image/jpeg",
    sha256: "0".repeat(64),
    signal,
  });

  it("signs a DetectFaces call with ALL attributes and maps the response", async () => {
    let seen: Request | undefined;
    vi.stubGlobal("fetch", async (request: Request) => {
      seen = request;
      return new Response(JSON.stringify(response("smiling")), { status: 200 });
    });

    const result = await provider().score(input());

    expect(seen).toBeDefined();
    const request = seen as Request;
    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://rekognition.eu-central-1.amazonaws.com/");
    expect(request.headers.get("x-amz-target")).toBe("RekognitionService.DetectFaces");
    expect(request.headers.get("content-type")).toBe("application/x-amz-json-1.1");
    expect(request.headers.get("authorization")).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/\d{8}\/eu-central-1\/rekognition\/aws4_request/,
    );
    expect(await request.json()).toEqual({
      Image: { Bytes: "/9j/" },
      Attributes: ["ALL"],
    });
    expect(result.faces).toHaveLength(1);
    expect(result.costMicros).toBe(REKOGNITION_COST_MICROS_PER_IMAGE);
  });

  it("classifies an HTTP error body by its __type", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ __type: "ThrottlingException", message: "slow down" }), {
          status: 400,
        }),
    );

    await expect(provider().score(input())).rejects.toMatchObject({
      kind: "retryable",
      code: "throttled",
    });
  });

  it("surfaces a 503 after exactly one fetch (aws4fetch retries disabled)", async () => {
    let fetches = 0;
    vi.stubGlobal("fetch", async () => {
      fetches += 1;
      return new Response(
        JSON.stringify({ __type: "InternalServerError", message: "boom" }),
        { status: 503 },
      );
    });

    await expect(provider().score(input())).rejects.toMatchObject({
      kind: "retryable",
      code: "server_error",
    });
    expect(fetches).toBe(1);
  });

  it("passes the AbortSignal through to fetch", async () => {
    vi.stubGlobal("fetch", (request: Request) => {
      const { promise, reject } = Promise.withResolvers<Response>();
      const abort = () => {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        reject(error);
      };
      if (request.signal.aborted) {
        abort();
      } else {
        request.signal.addEventListener("abort", abort, { once: true });
      }
      return promise;
    });

    const controller = new AbortController();
    const pending = provider().score(input(controller.signal));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ kind: "retryable", code: "timeout" });
  });
});