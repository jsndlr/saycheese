import {
  ERROR_MESSAGES,
  isErrorCode,
  type ErrorCode,
} from "@saycheese/core/errors";
import { ConvexError } from "convex/values";

import { mapAuthErrorCode } from "./auth-errors";

export type UiErrorAction = "retry" | "sign-in" | "change-file" | "wait" | "none";

export type UiError = {
  readonly code: ErrorCode;
  readonly message: string;
  readonly retryAfterMs?: number;
  readonly action: UiErrorAction;
};

/**
 * Every core code needs an action. `Record<ErrorCode, ...>` makes a new core
 * code a type error here until its UI action is decided.
 */
const ACTIONS: Record<ErrorCode, UiErrorAction> = {
  AUTH_REQUIRED: "sign-in",
  FORBIDDEN: "none",
  INVALID_CREDENTIALS: "none",
  EMAIL_TAKEN: "none",
  VALIDATION_FAILED: "none",
  PAYLOAD_TOO_LARGE: "change-file",
  UNSUPPORTED_MEDIA_TYPE: "change-file",
  HEIC_UNSUPPORTED: "change-file",
  ANIMATED_UNSUPPORTED: "change-file",
  IMAGE_TOO_LARGE: "change-file",
  IMAGE_TOO_SMALL: "change-file",
  IMAGE_CORRUPT: "change-file",
  IMAGE_TIMEOUT: "retry",
  UPLOAD_EXPIRED: "retry",
  RATE_LIMITED: "wait",
  SCORING_QUOTA: "wait",
  SCORING_UNAVAILABLE: "retry",
  NOT_FOUND: "none",
  NETWORK: "retry",
  INTERNAL: "retry",
};

type CorePayload = {
  readonly code: ErrorCode;
  readonly retryAfterMs?: number;
};

function readRetryAfter(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function isConvexError(value: unknown): value is { data: unknown } {
  // `instanceof` misses a separately bundled copy; the class also sets `name`.
  return (
    value instanceof ConvexError ||
    (typeof value === "object" &&
      value !== null &&
      "name" in value &&
      value.name === "ConvexError" &&
      "data" in value)
  );
}

/** Any object carrying Convex's error envelope, including a plain serialized Error. */
function errorData(value: unknown): { data: unknown } | null {
  if (isConvexError(value)) {
    return value;
  }
  if (typeof value === "object" && value !== null && "data" in value) {
    return value;
  }
  return null;
}

/**
 * Convex keeps `data` as a value in the websocket path, but some transports
 * (HTTP client, serialized errors) hand it over as the original JSON string.
 */
function readPayload(value: unknown): CorePayload | null {
  let candidate = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }

  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate) ||
    !("code" in candidate)
  ) {
    return null;
  }

  const code = candidate.code;
  if (typeof code !== "string" || !isErrorCode(code)) {
    return null;
  }

  const detail = "detail" in candidate ? candidate.detail : undefined;
  const retryAfterMs =
    typeof detail === "object" && detail !== null && "retryAfterMs" in detail
      ? readRetryAfter(detail.retryAfterMs)
      : undefined;
  return retryAfterMs === undefined ? { code } : { code, retryAfterMs };
}

function toUi(code: ErrorCode, retryAfterMs?: number): UiError {
  const base = { code, message: ERROR_MESSAGES[code], action: ACTIONS[code] };
  return retryAfterMs === undefined ? base : { ...base, retryAfterMs };
}

/**
 * Better Auth surfaces three shapes:
 * - the client result: `{ code, message, status, statusText }`
 * - `APIError`: `{ name: "APIError", status, body: { code, message } }`
 * - `BetterFetchError`: `{ status, statusText, error: { code, message } }`
 * Missing any of them would drop real auth failures to INTERNAL.
 */
function betterAuthCode(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const name = "name" in value ? value.name : undefined;
  const status = "status" in value ? value.status : undefined;
  const statusText = "statusText" in value ? value.statusText : undefined;

  if (
    "code" in value &&
    typeof value.code === "string" &&
    (name === "APIError" ||
      name === "BetterAuthError" ||
      name === "BetterFetchError" ||
      (typeof status === "number" && typeof statusText === "string"))
  ) {
    return value.code;
  }

  const body = "body" in value ? value.body : undefined;
  if (
    (name === "APIError" || name === "BetterAuthError") &&
    typeof body === "object" &&
    body !== null &&
    "code" in body &&
    typeof body.code === "string"
  ) {
    return body.code;
  }

  const inner = "error" in value ? value.error : undefined;
  if (
    typeof status === "number" &&
    typeof statusText === "string" &&
    typeof inner === "object" &&
    inner !== null &&
    "code" in inner &&
    typeof inner.code === "string"
  ) {
    return inner.code;
  }

  return null;
}

const NETWORK_MESSAGE_PATTERNS = [
  /failed to fetch/i,
  /fetch failed/i,
  /network ?error/i,
  /load failed/i,
  /internet disconnected/i,
];

function isNetworkError(value: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return true;
  }
  const typeError =
    value instanceof TypeError ||
    (typeof value === "object" &&
      value !== null &&
      "name" in value &&
      value.name === "TypeError");
  if (!typeError) {
    return false;
  }
  const message =
    value instanceof Error
      ? value.message
      : typeof value === "object" && value !== null && "message" in value
        ? value.message
        : undefined;
  return (
    typeof message === "string" &&
    NETWORK_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))
  );
}

/**
 * Local and server-side Convex errors reach an error boundary as a plain
 * `Error` whose message embeds the payload; recover the known code without
 * exposing the message. Next.js production sanitises this to a digest only,
 * so callers that need auth routing should still redirect pre-emptively.
 */
function codeFromMessage(message: string): ErrorCode | null {
  for (const token of message.split(/[^A-Z0-9_]+/)) {
    if (isErrorCode(token)) {
      return token;
    }
  }
  return null;
}

/**
 * Maps anything thrown or returned by an API into stable UI copy plus the
 * action the UI should offer. Raw server messages, stack text and unknown
 * codes never reach the user.
 */
export function toUiError(error: unknown): UiError {
  const envelope = errorData(error);
  if (envelope !== null) {
    const payload = readPayload(envelope.data);
    // A recognised envelope with an unusable payload must stay opaque.
    return payload === null
      ? toUi("INTERNAL")
      : toUi(payload.code, payload.retryAfterMs);
  }

  if (isNetworkError(error)) {
    return toUi("NETWORK");
  }

  const authCode = betterAuthCode(error);
  if (authCode !== null) {
    return toUi(mapAuthErrorCode(authCode));
  }

  if (error instanceof Error) {
    const code = codeFromMessage(error.message);
    if (code !== null) {
      return toUi(code);
    }
  }

  return toUi("INTERNAL");
}

/**
 * Copy for a rate limit / quota wait. Callers append this to the core
 * RATE_LIMITED message, for example.
 */
export function formatRetryAfter(ms: number): string {
  const seconds = Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 1000)) : 0;
  if (seconds <= 5) {
    return "Try again in a few seconds";
  }
  if (seconds < 60) {
    return `Try again in ${seconds} seconds`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}