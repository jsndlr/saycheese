import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const signOut = vi.fn();

vi.mock("@/lib/auth-client", () => ({
  authClient: { signOut: (...args: unknown[]) => signOut(...args) },
}));

import { SIGN_OUT_ERROR, resetSigningOut, signOutUser, useSigningOut } from "@/lib/sign-out";

describe("signOutUser", () => {
  beforeEach(() => {
    signOut.mockReset();
  });

  it("flags leaving before the session clears and stays flagged on success", async () => {
    const pending = Promise.withResolvers<{ error: null }>();
    signOut.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useSigningOut());
    expect(result.current).toBe(false);

    let outcome: Promise<string | null>;
    act(() => {
      outcome = signOutUser();
    });
    expect(result.current).toBe(true);

    await act(async () => {
      pending.resolve({ error: null });
      expect(await outcome).toBeNull();
    });
    expect(result.current).toBe(true);

    // Signing back in without a reload must start clean.
    act(() => resetSigningOut());
    expect(result.current).toBe(false);
  });

  it("clears the flag and reports an error when the server refuses", async () => {
    signOut.mockResolvedValue({ error: { message: "nope" } });
    const { result } = renderHook(() => useSigningOut());

    let message: string | null = null;
    await act(async () => {
      message = await signOutUser();
    });

    expect(message).toBe(SIGN_OUT_ERROR);
    expect(result.current).toBe(false);
  });

  it("clears the flag and reports an error when the request throws", async () => {
    signOut.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useSigningOut());

    let message: string | null = null;
    await act(async () => {
      message = await signOutUser();
    });

    expect(message).toBe(SIGN_OUT_ERROR);
    expect(result.current).toBe(false);
  });
});
