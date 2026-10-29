import {
  MIN_FACE_CONFIDENCE,
  MIN_SHARPNESS,
  type ProviderFace,
  type ProviderResult,
} from "@saycheese/core/scoring";

import { ProviderError, type SmileProvider } from "./types";

export const STUB_MODEL = "stub-v1";

/**
 * Deterministic scoring stub: no network, no randomness, no clock reads. Every
 * field is derived from the sha256 so the same upload always produces the same
 * `ProviderResult`, which makes downstream retries, caching and tests replayable.
 *
 * ## Bucket table (byte 0 of the sha256)
 *
 * | byte 0    | share  | result                                                    |
 * | --------- | ------ | --------------------------------------------------------- |
 * | 0x00–0x1F | 12.5%  | no_face: `faces: []`                                      |
 * | 0x20–0x3F | 12.5%  | multiple_faces: dominant scored face + 1–2 smaller faces  |
 * | 0x40–0x4F | 6.25%  | low_quality: face confidence 40–89 (< MIN_FACE_CONFIDENCE) |
 * | 0x50–0x5F | 6.25%  | low_quality: sharpness 0–19 (< MIN_SHARPNESS)             |
 * | 0x60–0xFF | 62.5%  | scored: smile confidence 10–90                            |
 *
 * The remaining bytes feed the values inside each bucket: `word(1)` picks the
 * smile confidence (10 + word % 81, i.e. exactly 10..90), `word(3)` the area,
 * `byte 5` the face confidence and `byte 6` the sharpness. Latency is 1–5 ms
 * and `costMicros` is always 0.
 *
 * ## Test-only overrides
 *
 * Any sha256 beginning with {@link STUB_TEST_PREFIX} (`fa11face`, 32 bits) is
 * reserved. The next byte selects the behaviour:
 *
 * | sha256 prefix            | behaviour                                                    |
 * | ------------------------ | ------------------------------------------------------------ |
 * | `fa11face00`             | throws `ProviderError` kind `retryable`, code `stub_retryable` |
 * | `fa11face01`             | throws `ProviderError` kind `fatal`, code `stub_fatal`       |
 * | `fa11face02` + 4 hex ms  | waits 0–65535 ms, then scores normally; abort-aware          |
 * | `fa11face03`             | returns `ProviderResult.error`, mapping to `unavailable`     |
 *
 * A real upload hits the prefix with probability 2^-32 (~1 in 4.3 billion).
 * The delay form reserves 16 more bits for the duration, so the whole reserved
 * space is still a subset of that 2^-32 and stays inert for real content.
 */

/** 32-bit reserved prefix for test-only behaviour overrides. */
export const STUB_TEST_PREFIX = "fa11face";

export const STUB_TEST_COMMAND = {
  retryable: "00",
  fatal: "01",
  delay: "02",
  resultError: "03",
} as const;

const SHA256_HEX = /^[0-9a-f]{64}$/;

function abortError(signal?: AbortSignal): Error {
  const error = new Error("The operation was aborted", { cause: signal?.reason });
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

function decodeSha256(sha256: string): Uint8Array {
  const hex = sha256.trim().toLowerCase();
  if (!SHA256_HEX.test(hex)) {
    throw new ProviderError(
      "fatal",
      "invalid_sha256",
      "The stub requires a 64-character hexadecimal sha256.",
    );
  }

  const bytes = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function word(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function latencyMs(bytes: Uint8Array): number {
  return 1 + ((bytes[7] ?? 0) % 5);
}

function scoredFace(bytes: Uint8Array): ProviderFace {
  return {
    area: 20_000 + (word(bytes, 3) % 10_000),
    smileConfidence: 10 + (word(bytes, 1) % 81),
    smileValue: true,
    faceConfidence: 95 + ((bytes[5] ?? 0) % 6),
    sharpness: 40 + ((bytes[6] ?? 0) % 61),
  };
}

function secondaryFace(bytes: Uint8Array, index: number): ProviderFace {
  const offset = 7 + index * 2;
  return {
    area: 5_000 + (word(bytes, offset) % 4_000),
    smileConfidence: word(bytes, offset + 1) % 101,
    smileValue: ((bytes[offset] ?? 0) & 1) === 1,
    faceConfidence: 95,
    sharpness: 60,
  };
}

function lowConfidenceFace(bytes: Uint8Array): ProviderFace {
  return {
    area: 20_000 + (word(bytes, 3) % 10_000),
    smileConfidence: 50,
    smileValue: true,
    faceConfidence: 40 + ((bytes[1] ?? 0) % (MIN_FACE_CONFIDENCE - 40)),
    sharpness: 60,
  };
}

function lowSharpnessFace(bytes: Uint8Array): ProviderFace {
  return {
    area: 20_000 + (word(bytes, 3) % 10_000),
    smileConfidence: 50,
    smileValue: true,
    faceConfidence: 99,
    sharpness: (bytes[1] ?? 0) % MIN_SHARPNESS,
  };
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  if (signal?.aborted) {
    reject(abortError(signal));
    return promise;
  }

  const onAbort = () => {
    clearTimeout(timer);
    reject(abortError(signal));
  };
  const timer = setTimeout(() => {
    signal?.removeEventListener("abort", onAbort);
    resolve();
  }, ms);
  signal?.addEventListener("abort", onAbort, { once: true });
  return promise;
}

export const stubProvider: SmileProvider = {
  name: "stub",
  model: STUB_MODEL,
  acceptedMimes: ["image/webp", "image/jpeg", "image/png"],

  async score({ sha256, signal }): Promise<ProviderResult> {
    throwIfAborted(signal);
    const bytes = decodeSha256(sha256);
    const hex = sha256.trim().toLowerCase();

    if (hex.startsWith(STUB_TEST_PREFIX)) {
      const command = hex.slice(STUB_TEST_PREFIX.length, STUB_TEST_PREFIX.length + 2);
      if (command === STUB_TEST_COMMAND.retryable) {
        throw new ProviderError("retryable", "stub_retryable", "Stub simulated a retryable failure.");
      }
      if (command === STUB_TEST_COMMAND.fatal) {
        throw new ProviderError("fatal", "stub_fatal", "Stub simulated a fatal failure.");
      }
      if (command === STUB_TEST_COMMAND.delay) {
        const delayHex = hex.slice(STUB_TEST_PREFIX.length + 2, STUB_TEST_PREFIX.length + 6);
        const delay = Number.parseInt(delayHex, 16);
        await wait(Number.isNaN(delay) ? 0 : delay, signal);
        throwIfAborted(signal);
      }
      if (command === STUB_TEST_COMMAND.resultError) {
        return {
          faces: [],
          latencyMs: latencyMs(bytes),
          costMicros: 0,
          error: "Stub simulated a provider error result.",
        };
      }
    }

    const bucket = bytes[0] ?? 0;
    let faces: ProviderFace[];

    if (bucket <= 0x1f) {
      faces = [];
    } else if (bucket <= 0x3f) {
      const extraFaces = 1 + ((bytes[5] ?? 0) % 2);
      faces = [scoredFace(bytes)];
      for (let index = 0; index < extraFaces; index += 1) {
        faces.push(secondaryFace(bytes, index));
      }
    } else if (bucket <= 0x4f) {
      faces = [lowConfidenceFace(bytes)];
    } else if (bucket <= 0x5f) {
      faces = [lowSharpnessFace(bytes)];
    } else {
      faces = [scoredFace(bytes)];
    }

    return {
      faces,
      latencyMs: latencyMs(bytes),
      costMicros: 0,
    };
  },
};