import {
  buildRequestErrorEvent,
  logRequestError,
  type RequestErrorContext,
  type RequestErrorRequest,
} from "./lib/request-error-log";

/**
 * Next calls this for every unhandled error in a server request (render,
 * route handler, server action). The record is structured and PII-free; see
 * `lib/request-error-log`.
 */
export async function onRequestError(
  error: unknown,
  request: RequestErrorRequest,
  context: RequestErrorContext,
): Promise<void> {
  logRequestError(buildRequestErrorEvent(error, request, context));
}
