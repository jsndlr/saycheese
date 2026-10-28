export const ERROR_CODES = [
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "INVALID_CREDENTIALS",
  "EMAIL_TAKEN",
  "VALIDATION_FAILED",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "ANIMATED_UNSUPPORTED",
  "IMAGE_TOO_LARGE",
  "IMAGE_TOO_SMALL",
  "IMAGE_CORRUPT",
  "IMAGE_TIMEOUT",
  "UPLOAD_EXPIRED",
  "RATE_LIMITED",
  "SCORING_QUOTA",
  "SCORING_UNAVAILABLE",
  "NOT_FOUND",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  AUTH_REQUIRED: "Sign in to continue.",
  FORBIDDEN: "You do not have permission to do that.",
  INVALID_CREDENTIALS: "Email or password is incorrect.",
  EMAIL_TAKEN: "That email is already registered.",
  VALIDATION_FAILED: "Check the highlighted fields.",
  PAYLOAD_TOO_LARGE: "Image is larger than 8 MB.",
  UNSUPPORTED_MEDIA_TYPE: "Use a JPEG, PNG or WebP.",
  ANIMATED_UNSUPPORTED: "Animated images are not supported.",
  IMAGE_TOO_LARGE: "Image dimensions are too large.",
  IMAGE_TOO_SMALL: "Image is too small.",
  IMAGE_CORRUPT: "That file could not be read.",
  IMAGE_TIMEOUT: "Processing took too long, try again.",
  UPLOAD_EXPIRED: "Upload link expired, try again.",
  RATE_LIMITED: "Too many requests. Try again shortly.",
  SCORING_QUOTA: "Daily scoring limit reached.",
  SCORING_UNAVAILABLE: "Scoring is unavailable, try again.",
  NOT_FOUND: "Not found.",
  INTERNAL: "Something went wrong. Try again.",
};

const ERROR_CODE_SET: ReadonlySet<string> = new Set<string>(ERROR_CODES);

export function isErrorCode(value: string): value is ErrorCode {
  return ERROR_CODE_SET.has(value);
}

export type ErrorDetail = Readonly<Record<string, unknown>>;

export type ErrorPayload = {
  readonly code: ErrorCode;
  readonly message: string;
  readonly detail?: ErrorDetail;
};

export function errorPayload(code: ErrorCode, detail?: ErrorDetail): ErrorPayload {
  // Built conditionally so the payload stays JSON-shaped under exactOptionalPropertyTypes.
  if (detail === undefined) {
    return { code, message: ERROR_MESSAGES[code] };
  }
  return { code, message: ERROR_MESSAGES[code], detail };
}
