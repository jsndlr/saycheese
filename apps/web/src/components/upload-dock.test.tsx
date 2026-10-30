import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UploadDock } from "@/components/upload-dock";
import { UPLOAD_COPY } from "@/lib/copy";

type ObserverCallback = (entries: Array<{ isIntersecting: boolean }>) => void;

let callback: ObserverCallback = () => {};
const disconnect = vi.fn();

class FakeObserver {
  constructor(cb: ObserverCallback) {
    callback = cb;
  }
  observe() {}
  disconnect = disconnect;
}

function renderWithUploader() {
  return render(
    <>
      <section>
        <h2 id="uploader-heading">Score a smile</h2>
        <input id="photo-upload" type="file" />
      </section>
      <UploadDock />
    </>,
  );
}

describe("UploadDock", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    disconnect.mockClear();
  });

  it("stays hidden while the uploader is on screen", () => {
    renderWithUploader();

    const dock = screen.getByText(UPLOAD_COPY.choosePhoto, { selector: "button" }).parentElement;
    expect(dock?.getAttribute("aria-hidden")).toBe("true");
    expect(dock?.hasAttribute("inert")).toBe(true);
  });

  it("appears once the uploader scrolls away and opens the shared file input", () => {
    renderWithUploader();
    const click = vi.fn();
    document.getElementById("photo-upload")?.addEventListener("click", click);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    act(() => callback([{ isIntersecting: false }]));

    const button = screen.getByRole("button", { name: UPLOAD_COPY.choosePhoto });
    expect(button.parentElement?.getAttribute("aria-hidden")).toBe("false");
    expect(button.parentElement?.hasAttribute("inert")).toBe(false);

    fireEvent.click(button);
    expect(click).toHaveBeenCalledOnce();
    expect(scrollIntoView).toHaveBeenCalledOnce();

    act(() => callback([{ isIntersecting: true }]));
    expect(button.parentElement?.getAttribute("aria-hidden")).toBe("true");
  });

  it("stops observing on unmount", () => {
    const { unmount } = renderWithUploader();
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("stays hidden where IntersectionObserver is unavailable", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    renderWithUploader();

    const dock = screen.getByText(UPLOAD_COPY.choosePhoto, { selector: "button" }).parentElement;
    expect(dock?.getAttribute("aria-hidden")).toBe("true");
  });
});
