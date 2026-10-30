import { act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handlePhotosLinkClick, isPlainNavigationClick, scrollToPhotos } from "./photos";

const scrollIntoView = vi.fn();
let heading: HTMLHeadingElement;

function linkEvent(init: MouseEventInit = {}): MouseEvent {
  return new MouseEvent("click", {
    button: 0,
    bubbles: true,
    cancelable: true,
    ...init,
  });
}

function callClick(pathname: string, event: MouseEvent) {
  handlePhotosLinkClick(
    pathname,
    event as unknown as React.MouseEvent<HTMLAnchorElement>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  Element.prototype.scrollIntoView = scrollIntoView;
  heading = document.createElement("h2");
  heading.id = "photos";
  heading.tabIndex = -1;
  heading.textContent = "Your photos";
  document.body.append(heading);
});

afterEach(() => {
  cleanup();
  heading.remove();
  scrollIntoView.mockReset();
  vi.useRealTimers();
});

describe("isPlainNavigationClick", () => {
  it.each([
    ["meta", { metaKey: true }],
    ["ctrl", { ctrlKey: true }],
    ["shift", { shiftKey: true }],
    ["alt", { altKey: true }],
    ["middle button", { button: 1 }],
  ])("rejects a %s click", (_label, init) => {
    expect(isPlainNavigationClick(linkEvent(init))).toBe(false);
  });

  it("accepts an unmodified primary click", () => {
    expect(isPlainNavigationClick(linkEvent())).toBe(true);
  });

  it("rejects a prevented click", () => {
    const event = linkEvent();
    event.preventDefault();
    expect(isPlainNavigationClick(event)).toBe(false);
  });
});

describe("handlePhotosLinkClick", () => {
  it("moves focus and scrolls on a same-route plain click", () => {
    callClick("/app", linkEvent());
    act(() => {
      vi.runAllTimers();
    });

    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(heading);
  });

  it.each([
    ["meta", { metaKey: true }],
    ["ctrl", { ctrlKey: true }],
    ["shift", { shiftKey: true }],
    ["alt", { altKey: true }],
    ["middle button", { button: 1 }],
  ])("leaves a %s click to the browser", (_label, init) => {
    const event = linkEvent(init);
    callClick("/app", event);
    act(() => {
      vi.runAllTimers();
    });

    expect(event.defaultPrevented).toBe(false);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(heading);
  });

  it("does nothing when a handler already prevented the click", () => {
    const event = linkEvent();
    event.preventDefault();
    callClick("/app", event);
    act(() => {
      vi.runAllTimers();
    });

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("does nothing from another route", () => {
    callClick("/app/images/image-1", linkEvent());
    act(() => {
      vi.runAllTimers();
    });

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe("scrollToPhotos", () => {
  it("focuses the heading and scrolls it to the top", () => {
    expect(scrollToPhotos("auto")).toBe(true);

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
    expect(document.activeElement).toBe(heading);
  });
});
