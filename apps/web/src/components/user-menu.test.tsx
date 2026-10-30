import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useConvexAuth = vi.fn();
const useQuery = vi.fn();
const usePathname = vi.fn();
const setTheme = vi.fn();

vi.mock("convex/react", () => ({
  useConvexAuth: () => useConvexAuth(),
  useQuery: (...args: unknown[]) => useQuery(...args),
}));
vi.mock("@saycheese/backend/convex/_generated/api", () => ({
  api: { queries: { me: { current: "me.current" } } },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => usePathname(),
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", setTheme }),
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
  default: ({
    href,
    children,
    onClick,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  }) => (
    <a
      href={href}
      onClick={(event) => {
        onClick?.(event);
        // jsdom cannot navigate; keep the click inside the document.
        event.preventDefault();
      }}
      {...rest}
    >
      {children}
    </a>
  ),
}));

import { UserMenu } from "@/components/user-menu";
import { USER_MENU_COPY } from "@/lib/copy";
import { PHOTOS_HREF } from "@/lib/photos";

const scrollIntoView = vi.fn();

function renderMenu() {
  return render(
    <>
      <h2 id="photos" tabIndex={-1}>
        {USER_MENU_COPY.photos}
      </h2>
      <UserMenu />
    </>,
  );
}

async function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: USER_MENU_COPY.label }));
  return screen.findByRole("menuitem", { name: USER_MENU_COPY.photos });
}

describe("UserMenu", () => {
  beforeEach(() => {
    signingOut = false;
    usePathname.mockReturnValue("/app");
    useQuery.mockReturnValue({ user: { email: "ada@example.com" } });
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => {
    cleanup();
    scrollIntoView.mockReset();
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

  it("points the photos item at the collection from any route", async () => {
    usePathname.mockReturnValue("/app/images/image-1");
    useConvexAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });
    renderMenu();

    const item = await openMenu();

    expect(item.getAttribute("href")).toBe(PHOTOS_HREF);
  });

  it("closes the menu and moves focus to the collection on the same route", async () => {
    useConvexAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });
    renderMenu();

    const item = await openMenu();
    fireEvent.click(item);

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { level: 2, name: USER_MENU_COPY.photos }),
      ),
    );
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });

  it("leaves modified clicks native and keeps focus off the collection", async () => {
    useConvexAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });
    renderMenu();

    const item = await openMenu();
    const event = new MouseEvent("click", {
      button: 0,
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });
    item.dispatchEvent(event);

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).not.toBe(
      screen.getByRole("heading", { level: 2, name: USER_MENU_COPY.photos }),
    );
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("keeps the release build detail out of the account menu", async () => {
    useConvexAuth.mockReturnValue({ isAuthenticated: true, isLoading: false });
    useQuery.mockReturnValue({
      user: { email: "ada@example.com" },
      release: "2026.10.30",
    });
    renderMenu();

    await openMenu();

    expect(screen.queryByText(/Scoring config release/)).toBeNull();
    expect(screen.getByText("ada@example.com")).toBeTruthy();
  });
});
