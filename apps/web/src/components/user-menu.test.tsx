import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useConvexAuth = vi.fn();
const useQuery = vi.fn();

vi.mock("convex/react", () => ({
  useConvexAuth: () => useConvexAuth(),
  useQuery: (...args: unknown[]) => useQuery(...args),
}));
vi.mock("@saycheese/backend/convex/_generated/api", () => ({
  api: { queries: { me: { current: "me.current" } } },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
const resetSigningOut = vi.fn();
let signingOut = false;
vi.mock("@/lib/sign-out", () => ({
  signOutUser: vi.fn(),
  resetSigningOut: () => resetSigningOut(),
  useSigningOut: () => signingOut,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { UserMenu } from "@/components/user-menu";
import { USER_MENU_COPY } from "@/lib/copy";

describe("UserMenu", () => {
  beforeEach(() => {
    signingOut = false;
    useQuery.mockReturnValue({ user: { email: "ada@example.com" }, release: "1" });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("reserves space without any control while auth resolves", () => {
    useConvexAuth.mockReturnValue({ isAuthenticated: false, isLoading: true });
    const { container } = render(<UserMenu />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });

  it("offers a sign-in link when signed out", () => {
    useConvexAuth.mockReturnValue({ isAuthenticated: false, isLoading: false });
    render(<UserMenu />);

    const link = screen.getByRole("link", { name: USER_MENU_COPY.signIn });
    expect(link.getAttribute("href")).toBe("/sign-in");
  });

  it("clears a stale signing-out flag once signed out", () => {
    useConvexAuth.mockReturnValue({ isAuthenticated: false, isLoading: false });
    render(<UserMenu />);

    expect(resetSigningOut).toHaveBeenCalled();
  });

  it("suspends the account query while signing out", () => {
    signingOut = true;
    useConvexAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });
    render(<UserMenu />);

    expect(useQuery).toHaveBeenCalledWith("me.current", "skip");
  });

  it("shows the account button with the email initial when signed in", () => {
    useConvexAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });
    render(<UserMenu />);

    const button = screen.getByRole("button", { name: USER_MENU_COPY.label });
    expect(button.textContent).toBe("a");
  });
});
