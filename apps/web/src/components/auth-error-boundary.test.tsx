import { cleanup, render, screen } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recoverFromAuthError } from "@/lib/auth-recovery";

import { AuthErrorBoundary } from "./auth-error-boundary";

vi.mock("@/lib/auth-recovery", () => ({ recoverFromAuthError: vi.fn() }));

function Throws({ error }: { error: unknown }): never {
  throw error;
}

beforeEach(() => {
  // React logs caught render errors; they are the subject of these tests.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(recoverFromAuthError).mockReset();
});

describe("AuthErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    render(
      <AuthErrorBoundary>
        <p>menu</p>
      </AuthErrorBoundary>,
    );
    expect(screen.getByText("menu")).toBeTruthy();
  });

  it("recovers the session on AUTH_REQUIRED and shows the fallback instead of crashing", () => {
    render(
      <AuthErrorBoundary fallback={<p>placeholder</p>}>
        <Throws error={new ConvexError({ code: "AUTH_REQUIRED", message: "Sign in to continue." })} />
      </AuthErrorBoundary>,
    );
    expect(screen.getByText("placeholder")).toBeTruthy();
    expect(recoverFromAuthError).toHaveBeenCalledOnce();
  });

  it("passes any other error to the next boundary", () => {
    expect(() =>
      render(
        <AuthErrorBoundary>
          <Throws error={new ConvexError({ code: "FORBIDDEN", message: "no" })} />
        </AuthErrorBoundary>,
      ),
    ).toThrow();
    expect(recoverFromAuthError).not.toHaveBeenCalled();
  });
});
