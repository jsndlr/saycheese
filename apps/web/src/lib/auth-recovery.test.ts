import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recoverFromAuthError } from "./auth-recovery";

const reload = vi.fn();
const assign = vi.fn();
const original = window.location;

beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.clear();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...original, reload, assign },
  });
});

afterEach(() => {
  vi.useRealTimers();
  reload.mockReset();
  assign.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: original });
});

describe("recoverFromAuthError", () => {
  it("reloads first, so a stale token is replaced from the session cookie", () => {
    recoverFromAuthError("/app");
    expect(reload).toHaveBeenCalledOnce();
    expect(assign).not.toHaveBeenCalled();
  });

  it("goes to sign-in when the reload did not recover the session", () => {
    recoverFromAuthError("/app");
    vi.advanceTimersByTime(2_000);
    recoverFromAuthError("/app");
    expect(assign).toHaveBeenCalledWith("/sign-in?next=%2Fapp");
  });

  it("tries a reload again once the window has passed", () => {
    recoverFromAuthError("/app");
    vi.advanceTimersByTime(60_000);
    recoverFromAuthError("/app");
    expect(reload).toHaveBeenCalledTimes(2);
    expect(assign).not.toHaveBeenCalled();
  });
});
