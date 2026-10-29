import { cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatLocalTime } from "@/lib/relative-time";

import { LocalTime } from "./local-time";

const VALUE = Date.UTC(2026, 0, 15, 1, 30);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("LocalTime", () => {
  it("server-renders a UTC fallback with an explicit label", () => {
    const html = renderToString(<LocalTime value={VALUE} />);

    expect(html).toContain('dateTime="2026-01-15T01:30:00.000Z"');
    expect(html).toContain("2026-01-15 01:30 UTC");
  });

  it("server-renders the UTC fallback for a relative label too", () => {
    const html = renderToString(<LocalTime value={VALUE} mode="relative" />);

    expect(html).toContain("2026-01-15 01:30 UTC");
  });

  it("switches to the browser locale and timezone after mount", () => {
    vi.useFakeTimers();
    vi.setSystemTime(VALUE);

    render(<LocalTime value={VALUE} />);

    expect(screen.getByText(formatLocalTime(VALUE))).toBeTruthy();
    expect(screen.queryByText(/UTC$/)).toBeNull();
  });

  it("renders a relative label once mounted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(VALUE);

    render(<LocalTime value={VALUE - 2 * 60_000} mode="relative" />);

    expect(screen.getByText("2 minutes ago")).toBeTruthy();
  });
});
