import { cleanup, render, screen } from "@testing-library/react";
import { useConvexAuth } from "convex/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthGate } from "./auth-gate";

const replace = vi.fn();

vi.mock("convex/react", () => ({
  useConvexAuth: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

/** Stands in for a Convex subscription hook: it must not run when signed out. */
const subscribed = vi.fn();

function Child() {
  subscribed();
  return <p>subscribed child</p>;
}

function auth(isLoading: boolean, isAuthenticated: boolean) {
  vi.mocked(useConvexAuth).mockReturnValue({ isLoading, isAuthenticated } as never);
}

function gate(next = "/app/images/abc") {
  return (
    <AuthGate next={next} fallback={<p>preloaded fallback</p>}>
      <Child />
    </AuthGate>
  );
}

beforeEach(() => {
  replace.mockReset();
  subscribed.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("AuthGate", () => {
  it("paints the fallback and mounts nothing while auth is loading", () => {
    auth(true, false);

    render(gate());

    expect(screen.getByText("preloaded fallback")).toBeTruthy();
    expect(screen.queryByText("subscribed child")).toBeNull();
    expect(subscribed).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("renders the subscribed children once authenticated", () => {
    auth(false, true);

    render(gate());

    expect(screen.getByText("subscribed child")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it("redirects to sign-in with the current path when signed out", () => {
    auth(false, false);

    render(gate());

    expect(screen.queryByText("subscribed child")).toBeNull();
    expect(subscribed).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("/sign-in?next=%2Fapp%2Fimages%2Fabc");
  });

  it("unmounts the subscriptions when the session is lost", () => {
    auth(false, true);
    const { rerender } = render(gate());
    expect(screen.getByText("subscribed child")).toBeTruthy();
    const callsWhileAuthed = subscribed.mock.calls.length;

    auth(false, false);
    rerender(gate());

    expect(screen.queryByText("subscribed child")).toBeNull();
    expect(subscribed.mock.calls.length).toBe(callsWhileAuthed);
    expect(replace).toHaveBeenCalledWith("/sign-in?next=%2Fapp%2Fimages%2Fabc");
  });

  it("rejects an off-site next target", () => {
    auth(false, false);

    render(gate("https://evil.example/app"));

    expect(replace).toHaveBeenCalledWith("/sign-in?next=%2Fapp");
  });
});
