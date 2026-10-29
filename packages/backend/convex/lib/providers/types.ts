import type { ProviderResult } from "@saycheese/core/scoring";

/**
 * Runtime-neutral provider contract. Nothing here may import Node built-ins or
 * an SDK: the adapters in tasks 4/5 own those dependencies, while the stub and
 * the selection logic run anywhere Convex does.
 */

export type ProviderName = "rekognition" | "vision" | "stub";

export type SmileProviderInput = {
  bytes: Uint8Array;
  mime: string;
  sha256: string;
  signal?: AbortSignal;
};

export interface SmileProvider {
  name: ProviderName;
  model: string;
  /** Resolves with raw faces/telemetry; core `mapProviderResult` owns scoring. */
  score(input: SmileProviderInput): Promise<ProviderResult>;
}

export type ProviderErrorKind = "retryable" | "fatal";

/**
 * Adapter failures are typed so the scoring action can decide between a retry,
 * a fallback provider and a terminal image failure without parsing messages.
 *
 * `code` is a short stable identifier (`timeout`, `throttled`, `auth`, ...) and
 * is persisted/logged; the message is for humans only.
 */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly code: string;

  constructor(
    kind: ProviderErrorKind,
    code: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ProviderError";
    this.kind = kind;
    this.code = code;
  }
}

/** Only `retryable` provider errors are worth another attempt. */
export function isRetryable(error: unknown): error is ProviderError & { kind: "retryable" } {
  return error instanceof ProviderError && error.kind === "retryable";
}