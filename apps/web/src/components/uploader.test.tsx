import { ERROR_MESSAGES } from "@saycheese/core/errors";
import { MAX_UPLOAD_BYTES } from "@saycheese/core/limits";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { createHash } from "node:crypto";
import { webcrypto } from "node:crypto";
import { setTimeout as nodeSetTimeout } from "node:timers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Uploader } from "./uploader";

vi.mock("convex/react", () => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

class FakeXHR {
  static instances: FakeXHR[] = [];

  upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
    onprogress: null,
  };
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  timeout = 0;
  aborted = false;
  abort = vi.fn(() => {
    this.aborted = true;
    this.onabort?.();
  });
  status = 200;
  responseText = JSON.stringify({ storageId: "storage-1" });

  constructor() {
    FakeXHR.instances.push(this);
  }
}

const createUpload = vi.fn();
const commitUpload = vi.fn();
let hookCall = 0;

beforeEach(() => {
  FakeXHR.instances = [];
  hookCall = 0;
  createUpload.mockReset();
  commitUpload.mockReset();
  vi.mocked(useQuery).mockReset();
  vi.mocked(useQuery).mockReturnValue(undefined);
  vi.mocked(useMutation).mockReset();
  // The component calls createUpload first and commitUpload second on every
  // render; alternating keeps the order stable across re-renders.
  vi.mocked(useMutation).mockImplementation(
    (() =>
      hookCall++ % 2 === 0
        ? createUpload
        : commitUpload) as unknown as typeof useMutation,
  );
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  Object.defineProperty(globalThis.crypto, "subtle", {
    configurable: true,
    value: webcrypto.subtle,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function uploadInput(): HTMLInputElement {
  const input = document.getElementById("photo-upload");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("Upload input not rendered");
  }
  return input;
}

describe("Uploader pre-checks", () => {
  it("rejects a file over the byte cap before any network call", () => {
    render(<Uploader />);
    const file = new File(
      [new Uint8Array(MAX_UPLOAD_BYTES + 1)],
      "large.jpg",
      { type: "image/jpeg" },
    );

    fireEvent.change(uploadInput(), { target: { files: [file] } });

    expect(screen.getByRole("alert").textContent).toContain(
      ERROR_MESSAGES.PAYLOAD_TOO_LARGE,
    );
    expect(createUpload).not.toHaveBeenCalled();
    expect(FakeXHR.instances).toHaveLength(0);
  });

  it("rejects a HEIC file before any network call", () => {
    render(<Uploader />);
    const file = new File(["heic"], "photo.heic", { type: "image/heic" });

    fireEvent.change(uploadInput(), { target: { files: [file] } });

    expect(screen.getByRole("alert").textContent).toContain(
      ERROR_MESSAGES.HEIC_UNSUPPORTED,
    );
    expect(createUpload).not.toHaveBeenCalled();
    expect(FakeXHR.instances).toHaveLength(0);
  });

  it("the change-file action opens the picker and focuses the label", () => {
    render(<Uploader />);
    const input = uploadInput();
    const click = vi.spyOn(input, "click").mockImplementation(() => {});
    fireEvent.change(input, {
      target: { files: [new File(["heic"], "photo.heic", { type: "image/heic" })] },
    });

    screen.getByRole("button", { name: "Choose another photo" }).click();

    expect(click).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(
      document.querySelector('label[for="photo-upload"]'),
    );
  });
});

describe("Uploader flow", () => {
  it("hashes, creates, uploads and commits in order", async () => {
    createUpload.mockResolvedValue({
      uploadUrl: "https://upload.test/photo",
      expiresAt: Date.now() + 60_000,
    });
    commitUpload.mockResolvedValue({ id: "image-1", deduplicated: false });

    render(<Uploader />);
    const file = new File(["hello"], "photo.jpg", { type: "image/jpeg" });
    fireEvent.change(uploadInput(), { target: { files: [file] } });

    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    const xhr = FakeXHR.instances[0];
    await waitFor(() => expect(xhr.send).toHaveBeenCalledWith(file));

    expect(xhr.open).toHaveBeenCalledWith("POST", "https://upload.test/photo");
    expect(xhr.setRequestHeader).toHaveBeenCalledWith(
      "Content-Type",
      "image/jpeg",
    );

    await act(async () => {
      xhr.upload.onprogress?.({
        lengthComputable: true,
        loaded: 5,
        total: 10,
      } as ProgressEvent);
    });
    expect(screen.getByText("Uploading 50%")).toBeTruthy();

    await act(async () => {
      xhr.status = 200;
      xhr.responseText = JSON.stringify({ storageId: "storage-1" });
      xhr.onload?.();
    });

    await waitFor(() =>
      expect(commitUpload).toHaveBeenCalledWith({
        storageId: "storage-1",
        sha256: createHash("sha256").update("hello").digest("hex"),
        bytes: 5,
        mime: "image/jpeg",
      }),
    );

    expect(createUpload.mock.invocationCallOrder[0]).toBeLessThan(
      xhr.send.mock.invocationCallOrder[0],
    );
    expect(xhr.send.mock.invocationCallOrder[0]).toBeLessThan(
      commitUpload.mock.invocationCallOrder[0],
    );
  });

  it("restarts from createUpload after UPLOAD_EXPIRED", async () => {
    createUpload
      .mockResolvedValueOnce({
        uploadUrl: "https://upload.test/one",
        expiresAt: Date.now() + 60_000,
      })
      .mockResolvedValueOnce({
        uploadUrl: "https://upload.test/two",
        expiresAt: Date.now() + 60_000,
      });
    commitUpload.mockRejectedValueOnce(
      new ConvexError({ code: "UPLOAD_EXPIRED", message: "expired" }),
    );

    render(<Uploader />);
    fireEvent.change(uploadInput(), {
      target: { files: [new File(["hello"], "photo.jpg", { type: "image/jpeg" })] },
    });

    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    await act(async () => {
      FakeXHR.instances[0].status = 200;
      FakeXHR.instances[0].responseText = JSON.stringify({
        storageId: "storage-1",
      });
      FakeXHR.instances[0].onload?.();
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        ERROR_MESSAGES.UPLOAD_EXPIRED,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(createUpload).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(2));
    expect(FakeXHR.instances[1].open).toHaveBeenCalledWith(
      "POST",
      "https://upload.test/two",
    );
  });

  it("restarts from createUpload when the URL expired before retry", async () => {
    createUpload.mockResolvedValue({
      uploadUrl: "https://upload.test/expired",
      expiresAt: Date.now() - 1,
    });

    render(<Uploader />);
    fireEvent.change(uploadInput(), {
      target: { files: [new File(["hello"], "photo.jpg", { type: "image/jpeg" })] },
    });

    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    await act(async () => {
      FakeXHR.instances[0].onerror?.();
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        ERROR_MESSAGES.NETWORK,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(createUpload).toHaveBeenCalledTimes(2));
  });

  it("counts down a rate limit before retrying the limited commit", async () => {
    vi.useFakeTimers({ now: Date.now() });
    createUpload.mockResolvedValue({
      uploadUrl: "https://upload.test/photo",
      expiresAt: Date.now() + 3_600_000,
    });
    commitUpload
      .mockRejectedValueOnce(
        new ConvexError({
          code: "RATE_LIMITED",
          message: "slow down",
          detail: { retryAfterMs: 60_000 },
        }),
      )
      .mockResolvedValueOnce({ id: "image-1", deduplicated: false });

    render(<Uploader />);
    fireEvent.change(uploadInput(), {
      target: { files: [new File(["hello"], "photo.jpg", { type: "image/jpeg" })] },
    });

    for (let i = 0; i < 200 && FakeXHR.instances.length === 0; i += 1) {
      await flushMicrotasks();
    }
    const xhr = FakeXHR.instances[0];
    await act(async () => {
      xhr.status = 200;
      xhr.responseText = JSON.stringify({ storageId: "storage-1" });
      xhr.onload?.();
    });
    await flushMicrotasks(20);

    expect(screen.getByRole("alert").textContent).toContain(
      ERROR_MESSAGES.RATE_LIMITED,
    );
    expect(screen.getByText("Try again in 1 minute")).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText("Try again in 59 seconds")).toBeTruthy();
    expect(commitUpload).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 59; i += 1) {
      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });
    }

    const retry = screen.getByRole("button", { name: "Try again" });
    expect(commitUpload).toHaveBeenCalledTimes(1);

    fireEvent.click(retry);
    await flushMicrotasks(20);

    expect(commitUpload).toHaveBeenCalledTimes(2);
    expect(commitUpload.mock.calls[1][0]).toMatchObject({
      storageId: "storage-1",
    });
    expect(createUpload).toHaveBeenCalledTimes(1);
  });

  it("aborts a stalled upload into the retry state", async () => {
    vi.useFakeTimers({ now: Date.now() });
    createUpload.mockResolvedValue({
      uploadUrl: "https://upload.test/photo",
      expiresAt: Date.now() + 3_600_000,
    });

    render(<Uploader />);
    fireEvent.change(uploadInput(), {
      target: { files: [new File(["hello"], "photo.jpg", { type: "image/jpeg" })] },
    });

    for (let i = 0; i < 200 && FakeXHR.instances.length === 0; i += 1) {
      await flushMicrotasks();
    }
    const xhr = FakeXHR.instances[0];
    expect(xhr.timeout).toBe(60_000);

    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    await flushMicrotasks(20);

    expect(xhr.aborted).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain(
      ERROR_MESSAGES.NETWORK,
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(uploadInput().disabled).toBe(false);
  });

  it("cancel returns to idle without an error and allows a new file", async () => {
    vi.useFakeTimers({ now: Date.now() });
    createUpload.mockResolvedValue({
      uploadUrl: "https://upload.test/photo",
      expiresAt: Date.now() + 3_600_000,
    });

    render(<Uploader />);
    fireEvent.change(uploadInput(), {
      target: { files: [new File(["hello"], "photo.jpg", { type: "image/jpeg" })] },
    });

    for (let i = 0; i < 200 && FakeXHR.instances.length === 0; i += 1) {
      await flushMicrotasks();
    }
    const xhr = FakeXHR.instances[0];

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await flushMicrotasks(20);

    expect(xhr.aborted).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(uploadInput().disabled).toBe(false);

    fireEvent.change(uploadInput(), {
      target: { files: [new File(["again"], "other.jpg", { type: "image/jpeg" })] },
    });
    for (let i = 0; i < 100 && createUpload.mock.calls.length < 2; i += 1) {
      await act(async () => { await new Promise<void>((resolve) => nodeSetTimeout(resolve, 10)); });
    }

    expect(createUpload).toHaveBeenCalledTimes(2);
  });

  it("aborts the upload and skips commit when unmounted mid-upload", async () => {
    vi.useFakeTimers({ now: Date.now() });
    createUpload.mockResolvedValue({
      uploadUrl: "https://upload.test/photo",
      expiresAt: Date.now() + 3_600_000,
    });

    const { unmount } = render(<Uploader />);
    fireEvent.change(uploadInput(), {
      target: { files: [new File(["hello"], "photo.jpg", { type: "image/jpeg" })] },
    });

    for (let i = 0; i < 200 && FakeXHR.instances.length === 0; i += 1) {
      await flushMicrotasks();
    }
    const xhr = FakeXHR.instances[0];

    unmount();
    await flushMicrotasks(20);

    expect(xhr.aborted).toBe(true);
    expect(commitUpload).not.toHaveBeenCalled();
  });

  it("never creates an upload when unmounted mid-hash", async () => {
    const { unmount } = render(<Uploader />);
    fireEvent.change(uploadInput(), {
      target: { files: [new File(["hello"], "photo.jpg", { type: "image/jpeg" })] },
    });

    unmount();
    await flushMicrotasks(20);

    expect(createUpload).not.toHaveBeenCalled();
    expect(FakeXHR.instances).toHaveLength(0);
  });
});

async function flushMicrotasks(rounds = 1) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => nodeSetTimeout(resolve, 10));
    });
  }
}