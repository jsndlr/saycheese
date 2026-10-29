import { toUiError } from "./errors";

/**
 * Convex rejects an id that is not a valid `v.id("images")` before the query
 * handler runs, and the HTTP transport delivers that failure as a plain string
 * payload. These are the shapes the deployment uses for a malformed id.
 */
const INVALID_IMAGE_ID = [
  /does not match validator[\s\S]*v\.id\("images"\)/i,
  /not a valid (?:convex )?id/i,
  /invalid id/i,
];

function textOf(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "object" && value !== null && "message" in value) {
    return typeof value.message === "string" ? value.message : null;
  }
  return null;
}

/**
 * A missing row, a foreign row, an archived row and an unparseable id are the
 * same user-facing outcome: the detail route renders not-found, never a 500.
 */
export function isImageNotFoundError(error: unknown): boolean {
  if (toUiError(error).code === "NOT_FOUND") {
    return true;
  }

  const data =
    typeof error === "object" && error !== null && "data" in error
      ? error.data
      : undefined;
  const text = textOf(data) ?? textOf(error);
  return text !== null && INVALID_IMAGE_ID.some((pattern) => pattern.test(text));
}
