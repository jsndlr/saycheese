import { describe, expect, it } from "vitest";
import { buildRequestErrorEvent } from "./request-error-log";

describe("request error logging", () => {
  it("keeps bounded metadata without logging error or request data", () => {
    const error = Object.assign(new Error("private@example.com token=secret"), { digest: "secret" });
    const event = buildRequestErrorEvent(error, { path: "/users/private@example.com?token=secret", method: "GET" }, { routerKind: "App Router", routePath: "/users/[id]", routeType: "render" });
    expect(event).toEqual({ event: "request_error", method: "GET", routerKind: "App Router", routeType: "render" });
    expect(JSON.stringify(event)).not.toMatch(/private|secret|users/);
  });
  it("rejects unexpected metadata", () => {
    expect(buildRequestErrorEvent("secret", { method: "secret" }, { routerKind: "secret", routeType: "secret" })).toEqual({ event: "request_error", method: null, routerKind: null, routeType: null });
  });
});