import type {
  ImageDto,
  ImageScoreDto,
} from "@saycheese/backend/convex/model/images";
import type { Id } from "@saycheese/backend/convex/_generated/dataModel";
import { ERROR_MESSAGES } from "@saycheese/core/errors";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScorePanel } from "./score-panel";

vi.mock("convex/react", () => ({
  useMutation: vi.fn(),
}));

const rescore = vi.fn();

beforeEach(() => {
  rescore.mockReset();
  vi.mocked(useMutation).mockImplementation(
    (() => rescore) as unknown as typeof useMutation,
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});


const BASE_SCORE: ImageScoreDto = {
  id: "score-1" as Id<"scores">,
  score: 87,
  confidence: 0.9,
  faceCount: 1,
  status: "scored",
  reason: "Scored",
  provider: "rekognition",
  createdAt: 1,
  cached: false,
};

function score(overrides: Partial<ImageScoreDto> = {}): ImageScoreDto {
  return { ...BASE_SCORE, ...overrides };
}

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
    score: score(),
    ...overrides,
  };
}

function buttonOf(): HTMLButtonElement {
  return screen.getByRole("button", {
    name: "Try scoring again",
  }) as HTMLButtonElement;
}

function renderPanel(value: ImageDto, previewUrl: string | null = null) {
  const onChangeFile = vi.fn();
  const result = render(
    <ScorePanel
      image={value}
      previewUrl={previewUrl}
      onChangeFile={onChangeFile}
    />,
  );
  return { ...result, onChangeFile };
}

describe("ScorePanel", () => {
  it.each(["uploaded", "processing", "ready"] as const)(
    "shows the checking copy for %s",
    (status) => {
      renderPanel(image({ status, score: null }));
      expect(screen.getByText("Checking your photo…")).toBeTruthy();
    },
  );

  it("shows the scoring copy with a reduced-motion safe spinner", () => {
    const { container } = renderPanel(image({ status: "scoring", score: null }));
    expect(screen.getByText("Scoring…")).toBeTruthy();
    const spinner = container.querySelector("svg");
    expect(spinner?.getAttribute("class")).toContain("motion-reduce:hidden");
  });

  it("renders the score, confidence, provider and cached badge", () => {
    renderPanel(image({ score: score({ cached: true, score: 91.5 }) }));

    expect(screen.getByText("92")).toBeTruthy();
    expect(screen.getByText("out of 100")).toBeTruthy();
    expect(screen.getByText("90% confidence")).toBeTruthy();
    expect(screen.getByText("Scored by Amazon Rekognition")).toBeTruthy();
    expect(screen.getByText("Cached result")).toBeTruthy();
  });

  it("renders the multiple faces explanation from faceCount", () => {
    renderPanel(
      image({
        score: score({
          status: "multiple_faces",
          faceCount: 3,
          score: 72,
          reason: "Scored the largest of 3 faces",
        }),
      }),
    );

    expect(screen.getByText("72")).toBeTruthy();
    expect(screen.getByText("Scored the largest of 3 faces")).toBeTruthy();
  });

  it("renders no_face", () => {
    renderPanel(
      image({
        score: score({ status: "no_face", score: null, confidence: null }),
      }),
    );
    expect(screen.getAllByText("No face detected")).toHaveLength(2);
  });

  it("renders the core low_quality reason", () => {
    renderPanel(
      image({
        score: score({
          status: "low_quality",
          score: null,
          reason: "Photo quality is too low to score",
        }),
      }),
    );
    expect(screen.getByText("Photo quality is too low to score")).toBeTruthy();
  });

  it("renders an unavailable outage reason without a quota reset", () => {
    renderPanel(
      image({
        score: score({
          status: "unavailable",
          score: null,
          confidence: null,
          reason: "Scoring is unavailable",
        }),
      }),
    );
    expect(screen.getAllByText("Scoring is unavailable")).toHaveLength(2);
    expect(screen.queryByText(/daily limit resets/i)).toBeNull();
  });

  it("renders the quota reason and the reset after the score's own window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    renderPanel(
      image({
        quotaExceeded: true,
        score: score({
          status: "unavailable",
          score: null,
          confidence: null,
          reason: "Daily scoring limit reached.",
          createdAt: Date.UTC(2026, 0, 15, 1),
        }),
      }),
    );
    expect(screen.getByText("Daily scoring limit reached.")).toBeTruthy();
    expect(screen.getAllByText(/Your daily limit resets on/)).toHaveLength(2);
  });

  it("says the quota has reset when the score's window has passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-17T00:00:00Z"));
    renderPanel(
      image({
        quotaExceeded: true,
        score: score({
          status: "unavailable",
          score: null,
          confidence: null,
          reason: "Daily scoring limit reached.",
          createdAt: Date.UTC(2026, 0, 15, 1),
        }),
      }),
    );
    expect(
      screen.getByText("Your daily limit has reset. Rescore this photo."),
    ).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "Your daily limit has reset. Rescore this photo.",
    );
    expect(screen.queryByText(/Your daily limit resets on/)).toBeNull();
  });

  it("calls rescore with the image id for an unavailable outage", async () => {
    rescore.mockResolvedValue(image());
    renderPanel(
      image({
        score: score({
          status: "unavailable",
          score: null,
          confidence: null,
          reason: "Scoring is unavailable",
        }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Try scoring again" }));
    await act(async () => {});

    expect(rescore).toHaveBeenCalledOnce();
    expect(rescore).toHaveBeenCalledWith({ id: "image-1" });
  });

  it("keeps the rescore button disabled until the new score row arrives", async () => {
    const pending = Promise.withResolvers<ImageDto>();
    rescore.mockReturnValue(pending.promise);
    const unavailable = score({
      status: "unavailable",
      score: null,
      confidence: null,
      reason: "Scoring is unavailable",
    });
    const { rerender } = renderPanel(image({ score: unavailable }));

    const button = screen.getByRole("button", {
      name: "Try scoring again",
    }) as HTMLButtonElement;
    fireEvent.click(button);
    await act(async () => {});

    expect(button.disabled).toBe(true);
    expect(rescore).toHaveBeenCalledOnce();

    // The mutation resolving is not the same as the panel updating: the live
    // query still reports the old score for a moment, and a re-enabled button
    // there would send a second request the server refuses.
    await act(async () => {
      pending.resolve(image());
    });
    expect(button.disabled).toBe(true);

    rerender(
      <ScorePanel
        image={image({ score: score({ id: "score-2" as Id<"scores"> }) })}
        previewUrl={null}
        onChangeFile={vi.fn()}
      />,
    );
    // The unavailable view is gone; the scored view has its own button.
    expect(button.isConnected).toBe(false);
    expect(
      (screen.getByRole("button", { name: "Score again" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("re-enables rescore if the row never changes after a successful call", async () => {
    vi.useFakeTimers();
    const pending = Promise.withResolvers<ImageDto>();
    rescore.mockReturnValue(pending.promise);
    renderPanel(
      image({
        score: score({
          status: "unavailable",
          score: null,
          confidence: null,
          reason: "Scoring is unavailable",
        }),
      }),
    );

    fireEvent.click(buttonOf());
    await act(async () => {});
    await act(async () => {
      pending.resolve(image());
    });
    expect(buttonOf().disabled).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(buttonOf().disabled).toBe(false);
  });

  it("offers a sign-in link when a rescore reports an expired session", async () => {
    rescore.mockRejectedValue(
      new ConvexError({ code: "AUTH_REQUIRED", message: "Sign in to continue." }),
    );
    renderPanel(
      image({
        score: score({
          status: "unavailable",
          score: null,
          confidence: null,
          reason: "Scoring is unavailable",
        }),
      }),
    );

    fireEvent.click(buttonOf());
    await act(async () => {});

    const link = screen.getByRole("link", { name: "Sign in" });
    expect(link.getAttribute("href")).toBe("/sign-in?next=%2Fapp");
  });

  it("hides rescore for a quota result until its window has reset", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    renderPanel(
      image({
        quotaExceeded: true,
        score: score({
          status: "unavailable",
          score: null,
          confidence: null,
          reason: "Daily scoring limit reached.",
          createdAt: Date.UTC(2026, 0, 15, 1),
        }),
      }),
    );

    expect(screen.queryByRole("button", { name: "Try scoring again" })).toBeNull();
    expect(screen.getAllByText(/Your daily limit resets on/)).toHaveLength(2);

    await act(async () => {
      vi.advanceTimersByTime(12 * 60 * 60 * 1_000);
    });

    expect(
      screen.getByText("Your daily limit has reset. Rescore this photo."),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Try scoring again" }),
    ).toBeTruthy();
  });

  it("shows the outage copy in an alert when rescore fails", async () => {
    rescore.mockRejectedValue(
      new ConvexError({ code: "SCORING_UNAVAILABLE", message: "down" }),
    );
    renderPanel(
      image({
        score: score({
          status: "unavailable",
          score: null,
          confidence: null,
          reason: "Scoring is unavailable",
        }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Try scoring again" }));
    await act(async () => {});

    expect(screen.getByRole("alert").textContent).toContain(
      ERROR_MESSAGES.SCORING_UNAVAILABLE,
    );
    expect(buttonOf().disabled).toBe(false);
  });

  it("counts down a rate-limited rescore and re-enables afterwards", async () => {
    vi.useFakeTimers({ now: Date.now() });
    rescore.mockRejectedValue(
      new ConvexError({
        code: "RATE_LIMITED",
        message: "slow down",
        detail: { retryAfterMs: 60_000 },
      }),
    );
    renderPanel(
      image({
        score: score({
          status: "unavailable",
          score: null,
          confidence: null,
          reason: "Scoring is unavailable",
        }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Try scoring again" }));
    await act(async () => {});

    expect(screen.getByRole("alert").textContent).toContain(
      ERROR_MESSAGES.RATE_LIMITED,
    );
    expect(screen.getByText("Try again in 1 minute")).toBeTruthy();
    expect(buttonOf().disabled).toBe(true);

    for (let i = 0; i < 60; i += 1) {
      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });
    }

    expect(buttonOf().disabled).toBe(false);
  });

  it("asks for confirmation before a forced rescore", async () => {
    rescore.mockResolvedValue(image());
    renderPanel(image());

    fireEvent.click(screen.getByRole("button", { name: "Score again" }));
    expect(
      screen.getByText(
        "Score this photo again? This uses one rescore from your hourly limit.",
      ),
    ).toBeTruthy();
    expect(rescore).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await act(async () => {});

    expect(rescore).toHaveBeenCalledOnce();
    expect(rescore).toHaveBeenCalledWith({ id: "image-1", force: true });
  });

  it("cancels a forced rescore without calling the mutation", () => {
    renderPanel(image());

    fireEvent.click(screen.getByRole("button", { name: "Score again" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(rescore).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    expect(screen.getByRole("button", { name: "Score again" })).toBeTruthy();
  });

  it("disables the forced rescore while it is pending", async () => {
    const pending = Promise.withResolvers<ImageDto>();
    rescore.mockReturnValue(pending.promise);
    renderPanel(image());

    fireEvent.click(screen.getByRole("button", { name: "Score again" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await act(async () => {});

    expect(
      (screen.getByRole("button", { name: "Score again" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(rescore).toHaveBeenCalledOnce();

    // Resolving is not the end: the button waits for the new score row.
    await act(async () => {
      pending.resolve(image());
    });
    expect(
      (screen.getByRole("button", { name: "Score again" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("counts down a rate-limited forced rescore", async () => {
    vi.useFakeTimers({ now: Date.now() });
    rescore.mockRejectedValue(
      new ConvexError({
        code: "RATE_LIMITED",
        message: "slow down",
        detail: { retryAfterMs: 60_000 },
      }),
    );
    renderPanel(image());

    fireEvent.click(screen.getByRole("button", { name: "Score again" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await act(async () => {});

    expect(screen.getByRole("alert").textContent).toContain(
      ERROR_MESSAGES.RATE_LIMITED,
    );
    expect(screen.getByText("Try again in 1 minute")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Score again" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    for (let i = 0; i < 60; i += 1) {
      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });
    }
    expect(
      (screen.getByRole("button", { name: "Score again" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("shows the outage copy when a forced rescore is refused", async () => {
    rescore.mockRejectedValue(
      new ConvexError({ code: "SCORING_UNAVAILABLE", message: "down" }),
    );
    renderPanel(image());

    fireEvent.click(screen.getByRole("button", { name: "Score again" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await act(async () => {});

    expect(screen.getByRole("alert").textContent).toContain(
      ERROR_MESSAGES.SCORING_UNAVAILABLE,
    );
  });

  it("offers a forced rescore for no_face and low_quality results", () => {
    const { unmount } = renderPanel(
      image({ score: score({ status: "no_face", score: null }) }),
    );
    expect(screen.getByRole("button", { name: "Score again" })).toBeTruthy();
    unmount();

    renderPanel(
      image({
        score: score({
          status: "low_quality",
          score: null,
          reason: "Photo quality is too low to score",
        }),
      }),
    );
    expect(screen.getByRole("button", { name: "Score again" })).toBeTruthy();
  });

  it("renders the failure code message and a change-file action", () => {
    const { onChangeFile } = renderPanel(
      image({ status: "failed", failureCode: "IMAGE_CORRUPT", score: null }),
    );
    expect(screen.getAllByText("That file could not be read.")).toHaveLength(2);
    screen.getByRole("button", { name: "Choose another photo" }).click();
    expect(onChangeFile).toHaveBeenCalledOnce();
  });

  it("renders the preview with explicit dimensions and alt text", () => {
    renderPanel(image(), "https://example.test/preview.webp");
    const preview = screen.getByAltText("Your uploaded photo");
    expect(preview.getAttribute("width")).toBe("640");
    expect(preview.getAttribute("height")).toBe("480");
    expect(preview.getAttribute("src")).toBe("https://example.test/preview.webp");
  });

  it("announces a terminal state once per image", () => {
    const processing = image({ status: "processing", score: null });
    const { rerender } = render(
      <ScorePanel image={processing} previewUrl={null} onChangeFile={vi.fn()} />,
    );
    const live = screen.getByRole("status");
    expect(live.textContent).toBe("");

    const scored = image({ score: score() });
    rerender(
      <ScorePanel image={scored} previewUrl={null} onChangeFile={vi.fn()} />,
    );
    expect(screen.getByRole("status").textContent).toBe(
      "Smile score 87 out of 100. Confidence 90 percent.",
    );

    rerender(
      <ScorePanel
        image={image({ score: score() })}
        previewUrl={null}
        onChangeFile={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe(
      "Smile score 87 out of 100. Confidence 90 percent.",
    );
  });

  it("announces the new result once after a rescore", () => {
    const unavailable = image({
      score: score({
        id: "score-1" as Id<"scores">,
        status: "unavailable",
        score: null,
        confidence: null,
        reason: "Scoring is unavailable",
      }),
    });
    const { rerender } = render(
      <ScorePanel image={unavailable} previewUrl={null} onChangeFile={vi.fn()} />,
    );
    expect(screen.getByRole("status").textContent).toBe("Scoring is unavailable");

    rerender(
      <ScorePanel
        image={image({ status: "scoring", score: null })}
        previewUrl={null}
        onChangeFile={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("");

    const rescored = image({
      score: score({ id: "score-2" as Id<"scores">, score: 92 }),
    });
    rerender(
      <ScorePanel image={rescored} previewUrl={null} onChangeFile={vi.fn()} />,
    );
    expect(screen.getByRole("status").textContent).toBe(
      "Smile score 92 out of 100. Confidence 90 percent.",
    );

    rerender(
      <ScorePanel
        image={image({
          score: score({ id: "score-2" as Id<"scores">, score: 92 }),
        })}
        previewUrl={null}
        onChangeFile={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe(
      "Smile score 92 out of 100. Confidence 90 percent.",
    );
  });
});