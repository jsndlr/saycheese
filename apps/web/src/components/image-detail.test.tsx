import type { ImageDto } from "@saycheese/backend/convex/model/images";
import type { Id } from "@saycheese/backend/convex/_generated/dataModel";
import { ERROR_MESSAGES } from "@saycheese/core/errors";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IMAGE_DETAIL_COPY } from "@/lib/copy";

import ImageDetail from "./image-detail";

const { push, success, archive, preloaded } = vi.hoisted(() => ({
  push: vi.fn(),
  success: vi.fn(),
  archive: vi.fn(),
  preloaded: { value: null as unknown, inaccessible: false },
}));

vi.mock("convex/react", () => ({
  useConvexAuth: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("sonner", () => ({
  toast: { success: (...args: unknown[]) => success(...args) },
}));

// The server payload only feeds the pre-auth fallback; the tests render the
// subscribed path, so one stub value is enough.
vi.mock("convex/nextjs", () => ({
  preloadedQueryResult: () => preloaded.value,
}));

function image(overrides: Partial<ImageDto> = {}): ImageDto {
  return {
    id: "image-1" as Id<"images">,
    sha256: "a".repeat(64),
    mime: "image/jpeg",
    bytes: 1024,
    width: 640,
    height: 480,
    status: "scored",
    failureCode: null,
    quotaExceeded: false,
    createdAt: 1,
    score: null,
    ...overrides,
  };
}

function renderDetail(value: ImageDto) {
  preloaded.value = value;
  vi.mocked(useQuery).mockImplementation((_query, args?) => {
    if (args === "skip") return undefined;
    if (preloaded.inaccessible) throw new ConvexError({ code: "NOT_FOUND", message: "gone" });
    return (args && "variant" in args ? { url: null } : value) as never;
  });
  return render(
    <ImageDetail
      preloaded={{} as never}
      preloadedOriginal={{ _args: { id: value.id, variant: "original" } } as never}
      next="/app/images/image-1"
    />,
  );
}

beforeEach(() => {
  preloaded.inaccessible = false;
  push.mockReset();
  success.mockReset();
  archive.mockReset();
  vi.mocked(useConvexAuth).mockReturnValue({
    isLoading: false,
    isAuthenticated: true,
  } as never);
  vi.mocked(useMutation).mockReturnValue(archive as never);
});

afterEach(() => {
  cleanup();
});

describe("ImageDetail archive", () => {
  it.each(["row", "original"])("shows photo not found when the %s subscription loses access", (query) => {
    const view = renderDetail(image());
    vi.mocked(useQuery).mockImplementation((_query, args?) => {
      const original = args && args !== "skip" && "variant" in args;
      if ((query === "original") === Boolean(original)) {
        throw new ConvexError({ code: "NOT_FOUND", message: "gone" });
      }
      return (original ? { url: null } : image()) as never;
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      view.rerender(<ImageDetail preloaded={{} as never} preloadedOriginal={{} as never} next="/app/images/image-1" />);
      expect(screen.getByText(IMAGE_DETAIL_COPY.notFoundHeading)).toBeTruthy();
      expect(screen.getByRole("link", { name: IMAGE_DETAIL_COPY.back }).getAttribute("href")).toBe("/app");
      expect(screen.queryByRole("button", { name: IMAGE_DETAIL_COPY.archive })).toBeNull();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("confirms, archives and navigates with a toast", async () => {
    archive.mockResolvedValue({ id: "image-1" });
    renderDetail(image());

    fireEvent.click(screen.getByRole("button", { name: IMAGE_DETAIL_COPY.archive }));
    expect(screen.getByText(IMAGE_DETAIL_COPY.archiveQuestion)).toBeTruthy();
    expect(archive).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await act(async () => {});

    expect(archive).toHaveBeenCalledOnce();
    expect(archive).toHaveBeenCalledWith({ id: "image-1" });
    expect(push).toHaveBeenCalledWith("/app");
    expect(success).toHaveBeenCalledWith(IMAGE_DETAIL_COPY.archivedToast);
  });

  it("suspends both subscriptions before NOT_FOUND arrives and keeps them suspended after success", async () => {
    const pending = Promise.withResolvers<{ id: string }>();
    archive.mockImplementation(() => {
      preloaded.inaccessible = true;
      return pending.promise;
    });
    renderDetail(image());
    fireEvent.click(screen.getByRole("button", { name: IMAGE_DETAIL_COPY.archive }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await act(async () => {});
    expect(screen.getByText(IMAGE_DETAIL_COPY.heading)).toBeTruthy();
    expect(vi.mocked(useQuery).mock.calls.slice(-2).map((call) => call[1])).toEqual(["skip", "skip"]);
    await act(async () => pending.resolve({ id: "image-1" }));
    expect(push).toHaveBeenCalledWith("/app");
    expect(vi.mocked(useQuery).mock.calls.slice(-2).map((call) => call[1])).toEqual(["skip", "skip"]);
  });
  it("cancels without calling the mutation", () => {
    renderDetail(image());

    fireEvent.click(screen.getByRole("button", { name: IMAGE_DETAIL_COPY.archive }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(archive).not.toHaveBeenCalled();
    expect(screen.queryByText(IMAGE_DETAIL_COPY.archiveQuestion)).toBeNull();
    expect(
      screen.getByRole("button", { name: IMAGE_DETAIL_COPY.archive }),
    ).toBeTruthy();
  });

  it("disables the action while the mutation is pending", async () => {
    const pending = Promise.withResolvers<{ id: string }>();
    archive.mockReturnValue(pending.promise);
    renderDetail(image());

    fireEvent.click(screen.getByRole("button", { name: IMAGE_DETAIL_COPY.archive }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await act(async () => {});

    const button = screen.getByRole("button", {
      name: IMAGE_DETAIL_COPY.archivePending,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    await act(async () => {
      pending.resolve({ id: "image-1" });
    });
  });

  it.each(["uploaded", "processing", "scoring"] as const)(
    "blocks archiving while the image is %s",
    (status) => {
      renderDetail(image({ status, score: null }));

      const button = screen.getByRole("button", {
        name: IMAGE_DETAIL_COPY.archive,
      }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(screen.getByText(IMAGE_DETAIL_COPY.archiveBlocked)).toBeTruthy();
    },
  );

  it("renders a failed archive in an alert", async () => {
    archive.mockRejectedValue(
      new ConvexError({ code: "NOT_FOUND", message: "gone" }),
    );
    renderDetail(image());

    fireEvent.click(screen.getByRole("button", { name: IMAGE_DETAIL_COPY.archive }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await act(async () => {});

    expect(screen.getByRole("alert").textContent).toContain(
      ERROR_MESSAGES.NOT_FOUND,
    );
    expect(push).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(vi.mocked(useQuery).mock.calls.slice(-2).every((call) => call[1] !== "skip")).toBe(true);
  });
});
