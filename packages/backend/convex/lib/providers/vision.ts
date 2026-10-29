import type { ProviderFace, ProviderResult } from "@saycheese/core/scoring";

import { toBase64 } from "./base64";
import { ProviderError, type SmileProvider } from "./types";

/**
 * Google Cloud Vision `images:annotate` adapter (FACE_DETECTION).
 *
 * No Google SDK: the REST call and the service-account JWT are built here with
 * Web Crypto, so the module stays importable from the edge-runtime selection
 * layer. Access tokens live in module scope until 60 s before expiry, so
 * repeated scores in one Convex action instance reuse a token instead of
 * exchanging a new one per image.
 */

export const VISION_MODEL = "vision-face-detection";
export const VISION_ACCEPTED_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export const VISION_SCOPE = "https://www.googleapis.com/auth/cloud-vision";

const ANNOTATE_URL = "https://vision.googleapis.com/v1/images:annotate";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const TOKEN_EXPIRY_SKEW_MS = 60_000;

/**
 * Per-image list price in micro-dollars (1000 micros = $0.001).
 *
 * Labelled placeholder assumption, not a verified price: confirm the current
 * FACE_DETECTION unit price for the billing project before relying on it.
 */
export const VISION_COST_MICROS_PER_IMAGE = 1_500;

export type VisionCredentials = {
  clientEmail: string;
  privateKey: string;
  tokenUri?: string;
};

/** The subset of a Vision `faceAnnotation` this adapter reads. */
export type VisionFaceAnnotation = {
  detectionConfidence?: number;
  joyLikelihood?: string;
  boundingPoly?: { vertices?: ReadonlyArray<{ x?: number; y?: number }> };
};

export type AnnotateResponse = {
  responses?: ReadonlyArray<{
    faceAnnotations?: VisionFaceAnnotation[];
    error?: { code?: number; message?: string; status?: string };
  }>;
};

type CachedToken = { accessToken: string; expiresAt: number };

// Keyed by service account + token endpoint: a deployment has one account, but
// a key prevents a stale token crossing accounts if that ever changes.
const tokenCache = new Map<string, CachedToken>();
// PKCS#8 import is async, so the promise is cached to keep one import per key.
const keyCache = new Map<string, Promise<CryptoKey>>();

const textEncoder = new TextEncoder();

function base64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? textEncoder.encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

async function serviceAccountKey(privateKey: string): Promise<CryptoKey> {
  const cached = keyCache.get(privateKey);
  if (cached !== undefined) return await cached;

  const imported = (async () => {
    const der = pemToDer(privateKey);
    return await crypto.subtle.importKey(
      "pkcs8",
      der,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  })();
  keyCache.set(privateKey, imported);
  try {
    return await imported;
  } catch (error) {
    keyCache.delete(privateKey);
    throw new ProviderError(
      "fatal",
      "invalid_credentials",
      "Google service-account private key could not sign the token assertion.",
      { cause: error },
    );
  }
}

/** Header and claims of the service-account assertion; exported for tests. */
export async function buildVisionJwt(
  credentials: VisionCredentials,
  nowMs = Date.now(),
): Promise<string> {
  const issuedAt = Math.floor(nowMs / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(
    JSON.stringify({
      iss: credentials.clientEmail,
      scope: VISION_SCOPE,
      aud: credentials.tokenUri ?? DEFAULT_TOKEN_URI,
      iat: issuedAt,
      exp: issuedAt + 3600,
    }),
  );
  const unsigned = `${header}.${claims}`;
  const key = await serviceAccountKey(credentials.privateKey);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    textEncoder.encode(unsigned),
  );

  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

async function accessToken(
  credentials: VisionCredentials,
  signal?: AbortSignal,
): Promise<string> {
  const tokenUri = credentials.tokenUri ?? DEFAULT_TOKEN_URI;
  const cacheKey = `${credentials.clientEmail}\n${tokenUri}`;
  const cached = tokenCache.get(cacheKey);
  if (cached !== undefined && cached.expiresAt - Date.now() > TOKEN_EXPIRY_SKEW_MS) {
    return cached.accessToken;
  }

  const assertion = await buildVisionJwt(credentials);
  let response: Response;
  try {
    response = await fetch(tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      signal,
    });
  } catch (error) {
    // A transport failure is a network condition, not a credential problem:
    // mark it retryable so one retry (and the configured fallback) can still
    // answer. An abort is the caller's timeout and is reported as such.
    if (signal?.aborted) {
      throw new ProviderError(
        "retryable",
        "token_exchange_aborted",
        "Google OAuth token exchange was aborted.",
        { cause: error },
      );
    }
    throw new ProviderError(
      "retryable",
      "token_exchange_failed",
      "Google OAuth token endpoint is unreachable.",
      { cause: error },
    );
  }

  if (!response.ok) {
    // 5xx and 429 are transient on Google's side; 4xx is a credential or
    // configuration fault that a retry would only repeat.
    const transient = response.status >= 500 || response.status === 429;
    throw new ProviderError(
      transient ? "retryable" : "fatal",
      "token_exchange_failed",
      `Google OAuth token endpoint returned HTTP ${response.status}.`,
    );
  }

  let payload: { access_token?: unknown; expires_in?: unknown };
  try {
    payload = (await response.json()) as typeof payload;
  } catch (error) {
    throw new ProviderError(
      "fatal",
      "token_exchange_failed",
      "Google OAuth token endpoint returned an unparseable response.",
      { cause: error },
    );
  }

  if (
    typeof payload.access_token !== "string" ||
    payload.access_token.length === 0 ||
    typeof payload.expires_in !== "number" ||
    !Number.isFinite(payload.expires_in)
  ) {
    throw new ProviderError(
      "fatal",
      "token_exchange_failed",
      "Google OAuth token endpoint returned no usable access token.",
    );
  }

  tokenCache.set(cacheKey, {
    accessToken: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
  });
  return payload.access_token;
}

/**
 * Classifies a Vision failure from either shape Google returns:
 *
 * - `status` / `httpStatus`: a non-200 HTTP body is
 *   `{ error: { code: <http status>, status: "RESOURCE_EXHAUSTED" } }`; the
 *   string status is authoritative, the numeric code is the HTTP status.
 * - `grpcCode`: a per-image error inside an HTTP 200 is a `google.rpc.Status`
 *   `{ code: number, ... }` with no string status, so the canonical gRPC code
 *   decides.
 *
 * Only throttling, 5xx/INTERNAL/UNAVAILABLE and deadline failures are
 * retryable; permissions and input errors are terminal so a bad image or
 * credential cannot loop.
 */
export function classifyVisionFailure(input: {
  httpStatus?: number;
  status?: string;
  grpcCode?: number;
}): ProviderError {
  const status = input.status;
  switch (status) {
    case "RESOURCE_EXHAUSTED":
      return new ProviderError("retryable", "throttled", "Vision quota exhausted.");
    case "UNAVAILABLE":
    case "INTERNAL":
      return new ProviderError("retryable", "server_error", `Vision failed (${status}).`);
    case "DEADLINE_EXCEEDED":
      return new ProviderError("retryable", "timeout", "Vision timed out.");
    case "INVALID_ARGUMENT":
      return new ProviderError("fatal", "invalid_argument", "Vision rejected the request or image.");
    case "PERMISSION_DENIED":
    case "UNAUTHENTICATED":
      return new ProviderError("fatal", "permission_denied", `Vision denied access (${status}).`);
    default:
      break;
  }

  switch (input.grpcCode) {
    case 4: // DEADLINE_EXCEEDED
      return new ProviderError("retryable", "timeout", "Vision timed out.");
    case 8: // RESOURCE_EXHAUSTED
      return new ProviderError("retryable", "throttled", "Vision quota exhausted.");
    case 13: // INTERNAL
    case 14: // UNAVAILABLE
      return new ProviderError(
        "retryable",
        "server_error",
        `Vision failed (gRPC ${input.grpcCode}).`,
      );
    case 3: // INVALID_ARGUMENT
      return new ProviderError("fatal", "invalid_argument", "Vision rejected the request or image.");
    case 5: // NOT_FOUND
      return new ProviderError("fatal", "not_found", "Vision could not find the requested resource.");
    case 7: // PERMISSION_DENIED
      return new ProviderError("fatal", "permission_denied", "Vision denied access (gRPC 7).");
    case 16: // UNAUTHENTICATED
      return new ProviderError("fatal", "permission_denied", "Vision denied access (gRPC 16).");
    case undefined:
      break;
    default:
      return new ProviderError(
        "fatal",
        "unexpected_error",
        `Unexpected Vision failure (gRPC ${input.grpcCode}).`,
      );
  }

  const httpStatus = input.httpStatus ?? 0;
  if (httpStatus === 429) {
    return new ProviderError("retryable", "throttled", "Vision throttled the request (429).");
  }
  if (httpStatus >= 500) {
    return new ProviderError("retryable", "server_error", `Vision returned HTTP ${httpStatus}.`);
  }
  if (httpStatus === 408) {
    return new ProviderError("retryable", "timeout", "Vision returned HTTP 408.");
  }
  if (httpStatus === 400) {
    return new ProviderError("fatal", "invalid_argument", "Vision rejected the request or image.");
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return new ProviderError(
      "fatal",
      "permission_denied",
      `Vision denied access (HTTP ${httpStatus}).`,
    );
  }
  return new ProviderError(
    "fatal",
    "unexpected_error",
    `Unexpected Vision failure (${status ?? httpStatus ?? "unknown"}).`,
  );
}

function finite(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Shoelace area of the annotation polygon; the vertices are image pixels. */
function polygonArea(
  vertices: ReadonlyArray<{ x?: number; y?: number }> | undefined,
): number {
  if (vertices === undefined || vertices.length < 3) return 0;
  let twiceArea = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    twiceArea +=
      (finite(current?.x) ?? 0) * (finite(next?.y) ?? 0) -
      (finite(next?.x) ?? 0) * (finite(current?.y) ?? 0);
  }
  return Math.abs(twiceArea) / 2;
}

/**
 * Pure mapping from Vision annotations to core faces plus the dominant face's
 * joy likelihood. Vision has no smile confidence or sharpness: both fields are
 * neutral (`null` / absent), and core maps the likelihood instead.
 */
export function toProviderResult(
  annotations: readonly VisionFaceAnnotation[],
): Pick<ProviderResult, "faces" | "joyLikelihood"> {
  let dominantIndex = -1;
  let dominantArea = -1;
  const faces: ProviderFace[] = annotations.map((annotation, index) => {
    const area = polygonArea(annotation.boundingPoly?.vertices);
    if (area > dominantArea) {
      dominantArea = area;
      dominantIndex = index;
    }
    return {
      area,
      smileConfidence: 0,
      smileValue: null,
      // Vision reports 0..1; core stores 0..100.
      faceConfidence: Math.min(100, Math.max(0, (finite(annotation.detectionConfidence) ?? 0) * 100)),
      // sharpness intentionally absent: Vision has no sharpness signal.
    };
  });

  return {
    faces,
    joyLikelihood: annotations[dominantIndex]?.joyLikelihood ?? "UNKNOWN",
  };
}

async function errorStatus(response: Response): Promise<string | undefined> {
  try {
    const payload = (await response.json()) as { error?: { status?: unknown } };
    return typeof payload.error?.status === "string" ? payload.error.status : undefined;
  } catch {
    return undefined;
  }
}

export function createVisionProvider(credentials: VisionCredentials): SmileProvider {
  return {
    name: "vision",
    model: VISION_MODEL,
    acceptedMimes: VISION_ACCEPTED_MIMES,

    async score({ bytes, signal }): Promise<ProviderResult> {
      const startedAt = Date.now();
      const token = await accessToken(credentials, signal);

      let response: Response;
      try {
        response = await fetch(ANNOTATE_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            requests: [
              {
                image: { content: toBase64(bytes) },
                features: [{ type: "FACE_DETECTION", maxResults: 10 }],
              },
            ],
          }),
          signal,
        });
      } catch (error) {
        if (signal?.aborted) {
          throw new ProviderError("retryable", "timeout", "Vision request was aborted.", {
            cause: error,
          });
        }
        throw new ProviderError("retryable", "network_error", "Vision is unreachable.", {
          cause: error,
        });
      }

      if (!response.ok) {
        // Non-200: the body's string `status` is authoritative; its numeric
        // `code` is the HTTP status, not a gRPC code, so it is not used here.
        throw classifyVisionFailure({
          httpStatus: response.status,
          status: await errorStatus(response),
        });
      }

      let payload: AnnotateResponse;
      try {
        payload = (await response.json()) as AnnotateResponse;
      } catch (error) {
        throw new ProviderError(
          "fatal",
          "unexpected_error",
          "Vision returned an unparseable response.",
          { cause: error },
        );
      }

      const annotation = payload.responses?.[0];
      if (annotation?.error !== undefined) {
        // HTTP 200 with a per-image google.rpc.Status: numeric gRPC code.
        throw classifyVisionFailure({
          grpcCode: annotation.error.code,
          status: annotation.error.status,
        });
      }

      return {
        ...toProviderResult(annotation?.faceAnnotations ?? []),
        latencyMs: Date.now() - startedAt,
        costMicros: VISION_COST_MICROS_PER_IMAGE,
      };
    },
  };
}