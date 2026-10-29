export type RequestErrorRequest = { path?: string; method?: string };
export type RequestErrorContext = { routerKind?: string; routePath?: string; routeType?: string };
export type RequestErrorEvent = {
  event: "request_error";
  method: string | null;
  routerKind: string | null;
  routeType: string | null;
};

export function buildRequestErrorEvent(
  _error: unknown,
  request: RequestErrorRequest,
  context: RequestErrorContext,
): RequestErrorEvent {
  const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
  const routers = ["App Router", "Pages Router"];
  const types = ["render", "route", "action", "middleware"];
  return {
    event: "request_error",
    method: methods.includes(request.method ?? "") ? request.method! : null,
    routerKind: routers.includes(context.routerKind ?? "") ? context.routerKind! : null,
    routeType: types.includes(context.routeType ?? "") ? context.routeType! : null,
  };
}

export function logRequestError(event: RequestErrorEvent): void {
  console.error(JSON.stringify(event));
}