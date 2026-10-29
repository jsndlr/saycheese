import type { ProviderFace, ProviderResult } from "@saycheese/core/scoring";
import { AwsClient } from "aws4fetch";

import { ProviderError, type SmileProvider } from "./types";

/**
 * AWS Rekognition `DetectFaces` adapter.
 *
 * Plan 6.1 mapping: one `ProviderFace` per `FaceDetail`
 * - `Confidence` -> `faceConfidence` (0..100), core divides by 100;
 * - `Smile.Value` + `Smile.Confidence` -> core `rekognitionSmileScore`;
 * - `Quality.Sharpness` -> `sharpness` (core rejects < MIN_SHARPNESS);
 * - `BoundingBox.Width * Height` -> `area` for `pickDominantFace`.
 *
 * `Attributes: ["ALL"]` is required: without it the response omits `Smile`
 * and `Quality`.
 *
 * The request is signed with `aws4fetch` (SigV4 over Web Crypto) instead of
 * `@aws-sdk/client-rekognition`: it is fetch-native and avoids pulling the
 * SDK's Node handlers and signers into the provider module. The scoring action
 * is `"use node"` for sharp (WebP -> JPEG conversion), not for this adapter.
 */

export const REKOGNITION_MODEL = "rekognition-detectfaces";
export const REKOGNITION_SERVICE = "rekognition";
/** DetectFaces accepts JPEG and PNG only; scoring converts the stored WebP. */
export const REKOGNITION_ACCEPTED_MIMES = ["image/jpeg", "image/png"] as const;

/**
 * Per-image list price in micro-dollars (1000 micros = $0.001).
 *
 * PLACEHOLDER / ASSUMPTION: this is not a verified figure. Plan 6.2 forbids
 * quoting an unconfirmed price; confirm the current DetectFaces list price for
 * the deployment region in the AWS pricing console and update this constant
 * (and the README) before enabling Rekognition in production.
 */
export const REKOGNITION_COST_MICROS_PER_IMAGE = 1_000;

export type RekognitionCredentials = {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/** The subset of the Rekognition `FaceDetail` this adapter reads. */
export type RekognitionFaceDetail = {
  Confidence?: number;
  BoundingBox?: {
    Width?: number;
    Height?: number;
    Left?: number;
    Top?: number;
  };
  Quality?: {
    Brightness?: number;
    Sharpness?: number;
  };
  Smile?: {
    Value?: boolean;
    Confidence?: number;
  };
};

export type DetectFacesResponse = {
  FaceDetails?: RekognitionFaceDetail[];
};

/** AWS SDK-shaped error details (`name`, `$metadata.httpStatusCode`). */
export type RekognitionErrorLike = {
  name?: string;
  message?: string;
  $metadata?: { httpStatusCode?: number };
};

const RETRYABLE_NAMES: Readonly<Record<string, true>> = {
  ThrottlingException: true,
  ProvisionedThroughputExceededException: true,
};

const FATAL_NAMES: Readonly<Record<string, string>> = {
  InvalidImageFormatException: "invalid_image",
  ImageTooLargeException: "image_too_large",
  InvalidParameterException: "invalid_parameter",
  AccessDeniedException: "access_denied",
  UnrecognizedClientException: "invalid_credentials",
  InvalidSignatureException: "invalid_credentials",
};

/** `com.amazonaws.rekognition#InvalidParameterException` -> `InvalidParameterException`. */
function errorName(error: RekognitionErrorLike): string {
  const raw = error.name ?? "";
  const separator = Math.max(raw.lastIndexOf("#"), raw.lastIndexOf("."));
  return separator >= 0 ? raw.slice(separator + 1) : raw;
}

/**
 * Classifies an AWS failure. Only throttling, 5xx and transport failures are
 * retryable; bad input, permissions and credentials are terminal. Anything
 * unrecognised is fatal so a bug cannot burn the retry budget.
 */
export function classifyRekognitionError(error: RekognitionErrorLike): ProviderError {
  const name = errorName(error);
  const status = error.$metadata?.httpStatusCode ?? 0;

  if (Object.hasOwn(RETRYABLE_NAMES, name)) {
    return new ProviderError(
      "retryable",
      "throttled",
      `Rekognition throttled the request (${name}).`,
      { cause: error },
    );
  }

  if (status >= 500 || name === "InternalServerError") {
    return new ProviderError(
      "retryable",
      "server_error",
      `Rekognition returned a server error (${name || status}).`,
      { cause: error },
    );
  }

  if (name === "AbortError" || name === "TimeoutError") {
    return new ProviderError("retryable", "timeout", "Rekognition request timed out.", {
      cause: error,
    });
  }

  // `fetch` rejects network failures with a TypeError ("fetch failed").
  if (name === "TypeError" || name === "FetchError") {
    return new ProviderError("retryable", "network_error", "Rekognition is unreachable.", {
      cause: error,
    });
  }

  const fatalCode = FATAL_NAMES[name];
  if (fatalCode !== undefined) {
    return new ProviderError(
      "fatal",
      fatalCode,
      `Rekognition rejected the request (${name}).`,
      { cause: error },
    );
  }

  return new ProviderError(
    "fatal",
    "unexpected_error",
    `Unexpected Rekognition failure (${name || status || "unknown"}).`,
    { cause: error },
  );
}

function finite(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Pure mapping from `FaceDetail[]` to core faces, kept separate from the
 * network call so recorded fixtures can be tested without credentials.
 */
export function toProviderFaces(
  details: readonly RekognitionFaceDetail[],
): ProviderFace[] {
  return details.map((detail) => {
    const width = finite(detail.BoundingBox?.Width) ?? 0;
    const height = finite(detail.BoundingBox?.Height) ?? 0;
    return {
      area: width * height,
      smileConfidence: finite(detail.Smile?.Confidence) ?? 0,
      smileValue:
        typeof detail.Smile?.Value === "boolean" ? detail.Smile.Value : null,
      faceConfidence: finite(detail.Confidence) ?? 0,
      sharpness: finite(detail.Quality?.Sharpness),
    };
  });
}

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Minimal base64 encoder: the default runtime has no `Buffer`. */
export function toBase64(bytes: Uint8Array): string {
  let output = "";
  let index = 0;
  for (; index + 2 < bytes.length; index += 3) {
    const chunk =
      ((bytes[index] ?? 0) << 16) |
      ((bytes[index + 1] ?? 0) << 8) |
      (bytes[index + 2] ?? 0);
    output +=
      BASE64_ALPHABET[(chunk >> 18) & 63] +
      BASE64_ALPHABET[(chunk >> 12) & 63] +
      BASE64_ALPHABET[(chunk >> 6) & 63] +
      BASE64_ALPHABET[chunk & 63];
  }

  const remaining = bytes.length - index;
  if (remaining === 1) {
    const chunk = (bytes[index] ?? 0) << 16;
    output +=
      BASE64_ALPHABET[(chunk >> 18) & 63] +
      BASE64_ALPHABET[(chunk >> 12) & 63] +
      "==";
  } else if (remaining === 2) {
    const chunk =
      ((bytes[index] ?? 0) << 16) | ((bytes[index + 1] ?? 0) << 8);
    output +=
      BASE64_ALPHABET[(chunk >> 18) & 63] +
      BASE64_ALPHABET[(chunk >> 12) & 63] +
      BASE64_ALPHABET[(chunk >> 6) & 63] +
      "=";
  }

  return output;
}

async function readErrorName(response: Response): Promise<string> {
  const header = response.headers.get("x-amzn-errortype");
  const fromHeader = header?.split(":")[0]?.split("#").pop()?.trim();
  if (fromHeader) return fromHeader;

  try {
    const payload = (await response.json()) as { __type?: unknown };
    if (typeof payload.__type === "string" && payload.__type.length > 0) {
      return payload.__type;
    }
  } catch {
    // Non-JSON error body: fall through to the status-derived name.
  }
  return `Http${response.status}`;
}

export function createRekognitionProvider(
  credentials: RekognitionCredentials,
): SmileProvider {
  const client = new AwsClient({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    service: REKOGNITION_SERVICE,
    region: credentials.region,
    // aws4fetch defaults to 10 internal retries with backoff on 5xx/429. That
    // would bypass the scoring action's single retry, hide attempts from
    // `scoringAttempts`, and sleep without the abort signal. Retries belong to
    // the action.
    retries: 0,
  });

  return {
    name: "rekognition",
    model: REKOGNITION_MODEL,
    acceptedMimes: REKOGNITION_ACCEPTED_MIMES,

    async score({ bytes, signal }): Promise<ProviderResult> {
      const startedAt = Date.now();
      const body = JSON.stringify({
        Image: { Bytes: toBase64(bytes) },
        Attributes: ["ALL"],
      });

      let response: Response;
      try {
        response = await client.fetch(
          `https://rekognition.${credentials.region}.amazonaws.com/`,
          {
            method: "POST",
            headers: {
              "content-type": "application/x-amz-json-1.1",
              "x-amz-target": "RekognitionService.DetectFaces",
            },
            body,
            signal,
          },
        );
      } catch (error) {
        if (signal?.aborted) {
          throw new ProviderError(
            "retryable",
            "timeout",
            "Rekognition request was aborted.",
            { cause: error },
          );
        }
        if (error instanceof ProviderError) throw error;
        throw classifyRekognitionError({
          name: error instanceof Error ? error.name : "TypeError",
          message: error instanceof Error ? error.message : String(error),
        });
      }

      if (!response.ok) {
        const name = await readErrorName(response);
        throw classifyRekognitionError({
          name,
          message: `HTTP ${response.status}`,
          $metadata: { httpStatusCode: response.status },
        });
      }

      let payload: DetectFacesResponse;
      try {
        payload = (await response.json()) as DetectFacesResponse;
      } catch (error) {
        throw new ProviderError(
          "fatal",
          "unexpected_error",
          "Rekognition returned an unparseable response.",
          { cause: error },
        );
      }

      return {
        faces: toProviderFaces(payload.FaceDetails ?? []),
        latencyMs: Date.now() - startedAt,
        costMicros: REKOGNITION_COST_MICROS_PER_IMAGE,
      };
    },
  };
}