import type {
  ImageDto,
  ImageScoreDto,
} from "@saycheese/backend/convex/model/images";
import type { Id } from "@saycheese/backend/convex/_generated/dataModel";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HISTORY_COPY } from "@/lib/copy";

import { ImageHistory } from "./image-history";

vi.mock("convex/react", () => ({
  useConvexAuth: vi.fn(),
  usePaginatedQuery: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const NOW = 1_700_000_000_000;
let nextId = 0;

const BASE_SCORE: ImageScoreDto = {
  id: "score-1" as Id<"scores">,
  score: 87,
  confidence: 0.9,
  faceCount: 1,
  status: "scored",
  reason: "Scored",
  provider: "stub",
  createdAt: NOW,
  cached: false,
};

function score(overrides: Partial<ImageScoreDto> = {}): ImageScoreDto {
  return { ...BASE_SCORE, ...overrides };
}

function image(overrides: Partial<ImageDto> = {}): ImageDto {
  nextId += 1;
  return {
    id: `image-${nextId}` as Id<"images">,
    sha256: "a".repeat(64),
    mime: "image/jpeg",
    bytes: 1024,
    width: 640,
    height: 480,
    status: "scored",
    failureCode: null,
    quotaExceeded: false,
    createdAt: NOW - 2 * 60_000,
    score: score(),
    ...overrides,
  };
}

function paginated(
  results: ImageDto[],
  status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted",
  loadMore = vi.fn(),
) {
  vi.mocked(usePaginatedQuery).mockReturnValue({
    results,
    status,
    isLoading: status === "LoadingFirstPage" || status === "LoadingMore",
    loadMore,
  } as never);
  return loadMore;
}

beforeEach(() => {
  nextId = 0;
  vi.mocked(useConvexAuth).mockReturnValue({
    isLoading: false,
    isAuthenticated: true,
  } as never);
  vi.mocked(useQuery).mockReset();
  vi.mocked(useQuery).mockReturnValue({ url: null } as never);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ImageHistory", () => {
  it("renders the score, cached badge and failed chip from the paginated result", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    paginated(
      [
        image({ score: score({ score: 91, cached: true }) }),
        image({ status: "failed", failureCode: "INTERNAL", score: null }),
      ],
      "Exhausted",
    );

    render(<ImageHistory next="/app" />);

    expect(screen.getByText(/^91/)).toBeTruthy();
    expect(screen.getByText(HISTORY_COPY.cached)).toBeTruthy();
    expect(screen.getByText(HISTORY_COPY.status.failed)).toBeTruthy();
    expect(screen.getAllByText("2 minutes ago")).toHaveLength(2);
    expect(screen.getAllByRole("link")[0]?.getAttribute("href")).toBe(
      "/app/images/image-1",
    );
  });

  it("loads the next page when Load more is pressed", () => {
    const loadMore = paginated([image()], "CanLoadMore");

    render(<ImageHistory next="/app" />);
    fireEvent.click(screen.getByRole("button", { name: HISTORY_COPY.loadMore }));

    expect(loadMore).toHaveBeenCalledWith(12);
  });

  it("shows the empty state when the query is exhausted", () => {
    paginated([], "Exhausted");

    render(<ImageHistory next="/app" />);

    expect(screen.getByText(HISTORY_COPY.empty)).toBeTruthy();
  });

  it("shows a skeleton while the first page loads", () => {
    paginated([], "LoadingFirstPage");

    render(<ImageHistory next="/app" />);

    expect(screen.getByRole("status").textContent).toBe(HISTORY_COPY.loading);
    expect(screen.queryByText(HISTORY_COPY.empty)).toBeNull();
  });
});
