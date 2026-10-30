import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const usePathname = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => usePathname(),
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
        event.preventDefault();
      }}
      {...rest}
    >
      {children}
    </a>
  ),
}));

vi.mock("./user-menu", () => ({
  UserMenu: () => <div data-testid="user-menu" />,
}));

import Header from "@/components/header";
import { USER_MENU_COPY } from "@/lib/copy";
import { PHOTOS_HREF } from "@/lib/photos";

const scrollIntoView = vi.fn();

function renderHeader() {
  return render(
    <>
      <h2 id="photos" tabIndex={-1}>
        {USER_MENU_COPY.photos}
      </h2>
      <Header />
    </>,
  );
}

describe("Header", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/app");
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => {
    cleanup();
    scrollIntoView.mockReset();
    vi.clearAllMocks();
  });

  it("keeps the logo as home and offers Your photos as the only page link", () => {
    renderHeader();

    expect(screen.getByRole("link", { name: "saycheese home" }).getAttribute("href")).toBe("/");
    const photos = screen.getByRole("link", { name: USER_MENU_COPY.photos });
    expect(photos.getAttribute("href")).toBe(PHOTOS_HREF);
    expect(photos.getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
    expect(screen.queryByRole("link", { name: "App" })).toBeNull();
  });

  it("moves to the collection when Your photos is clicked on the same route", async () => {
    renderHeader();
    const link = screen.getByRole("link", { name: USER_MENU_COPY.photos });

    fireEvent.click(link);
    fireEvent.click(link);

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { level: 2, name: USER_MENU_COPY.photos }),
      ),
    );
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2));
  });

  it("leaves the collection link active on a photo detail route", () => {
    usePathname.mockReturnValue("/app/images/image-1");
    renderHeader();

    expect(
      screen.getByRole("link", { name: USER_MENU_COPY.photos }).getAttribute("aria-current"),
    ).toBe("page");
  });
});
