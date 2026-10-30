"use client";

import { api } from "@saycheese/backend/convex/_generated/api";
import type { Id } from "@saycheese/backend/convex/_generated/dataModel";
import {
  exceedsByteCap,
  isAllowedImageMime,
  isHeicMime,
} from "@saycheese/core/limits";
import { Button } from "@saycheese/ui/components/button";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ScorePanel } from "@/components/score-panel";
import { signInPath } from "@/lib/auth-path";
import { UPLOAD_COPY } from "@/lib/copy";
import {
  formatRetryAfter,
  toUiError,
  uiErrorFromCode,
  type UiError,
} from "@/lib/errors";
import { useWaitCountdown } from "@/lib/use-wait-countdown";

type Step = "hash" | "createUpload" | "upload" | "commit";
type Phase = "idle" | "hashing" | "uploading" | "committing";

type Attempt = {
  file: File;
  step: Step;
  sha256: string | null;
  uploadUrl: string | null;
  storageId: Id<"_storage"> | null;
  expiresAt: number | null;
};

/**
 * A retry may only reuse the upload URL while it is valid. An expiry response
 * or a passed `expiresAt` restarts at `createUpload`, keeping the hash so the
 * file is not read and digested again.
 */
function attemptForRetry(attempt: Attempt, error: UiError | null): Attempt {
  const urlExpired =
    error?.code === "UPLOAD_EXPIRED" ||
    (attempt.expiresAt !== null && Date.now() >= attempt.expiresAt);

  if (!urlExpired) {
    return { ...attempt };
  }

  return {
    ...attempt,
    step: attempt.sha256 === null ? "hash" : "createUpload",
    uploadUrl: null,
    storageId: null,
    expiresAt: null,
  };
}

/**
 * The storage URL refused the body. Convex upload URLs are short-lived and the
 * client clock is not authoritative, so any refusal means "get a new URL and
 * send the same bytes again" rather than a dead end.
 */
class UploadUrlExpiredError extends Error {}

const HEIC_EXTENSION = /\.(heic|heif)$/i;

/**
 * A stalled socket must not hold the picker disabled forever. The hard cap
 * bounds the whole request; the stall guard bounds silence between progress
 * events, which is what a dropped connection actually looks like.
 */
const UPLOAD_TIMEOUT_MS = 60_000;
const UPLOAD_STALL_MS = 20_000;

/** Local abort, not a failure: the caller returns to idle without an alert. */
class UploadCancelledError extends Error {
  constructor() {
    super("Upload cancelled");
    this.name = "UploadCancelledError";
  }
}

/**
 * The message matters: `toUiError` recognises network failures by message, and
 * the retry path depends on this mapping to NETWORK.
 */
function uploadNetworkError(): TypeError {
  return new TypeError("Network error: the upload did not complete");
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * XHR is deliberate: `fetch` has no upload progress events in browsers, and
 * the plan asks for a real percentage rather than an indeterminate bar.
 */
function uploadWithProgress(
  uploadUrl: string,
  file: File,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;

    function finish() {
      settled = true;
      clearTimeout(stallTimer);
      stallTimer = undefined;
      signal.removeEventListener("abort", onSignalAbort);
    }

    function fail(error: unknown) {
      if (settled) {
        return;
      }
      finish();
      reject(error);
    }

    function armStallTimer() {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        fail(uploadNetworkError());
        xhr.abort();
      }, UPLOAD_STALL_MS);
    }

    function onSignalAbort() {
      fail(new UploadCancelledError());
      xhr.abort();
    }

    xhr.open("POST", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.upload.onprogress = (event) => {
      if (settled) {
        return;
      }
      armStallTimer();
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        fail(new UploadUrlExpiredError(`Upload refused with status ${xhr.status}`));
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        fail(new Error("Upload response was not valid JSON"));
        return;
      }

      if (
        typeof payload !== "object" ||
        payload === null ||
        !("storageId" in payload) ||
        typeof payload.storageId !== "string"
      ) {
        fail(new Error("Upload response did not include a storage id"));
        return;
      }

      if (!settled) {
        finish();
        resolve(payload.storageId);
      }
    };
    xhr.ontimeout = () => fail(uploadNetworkError());
    xhr.onerror = () => fail(new TypeError("Failed to fetch"));
    // `abort()` is also how the stall guard and cancel release the socket; by
    // then the promise is already settled, so this is a no-op.
    xhr.onabort = () => fail(uploadNetworkError());
    signal.addEventListener("abort", onSignalAbort, { once: true });
    armStallTimer();
    xhr.send(file);
  });
}

function precheck(file: File): UiError | null {
  if (exceedsByteCap(file.size)) {
    return uiErrorFromCode("PAYLOAD_TOO_LARGE");
  }
  if (isHeicMime(file.type) || HEIC_EXTENSION.test(file.name)) {
    return uiErrorFromCode("HEIC_UNSUPPORTED");
  }
  if (!isAllowedImageMime(file.type)) {
    return uiErrorFromCode("UNSUPPORTED_MEDIA_TYPE");
  }
  return null;
}

function LiveScore({
  imageId,
  onChangeFile,
}: {
  imageId: Id<"images">;
  onChangeFile: () => void;
}) {
  const image = useQuery(api.queries.images.byId, { id: imageId });
  const preview = useQuery(api.queries.images.fileUrl, {
    id: imageId,
    variant: "preview",
  });

  if (image === undefined) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {UPLOAD_COPY.resultLoading}
      </p>
    );
  }

  return (
    <ScorePanel
      image={image}
      previewUrl={preview?.url ?? null}
      onChangeFile={onChangeFile}
      compact
    />
  );
}

export function Uploader() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const labelRef = useRef<HTMLLabelElement>(null);
  const runningRef = useRef(false);
  const attemptRef = useRef<Attempt | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dragDepth = useRef(0);

  const createUpload = useMutation(api.commands.images.createUpload);
  const commitUpload = useMutation(api.commands.images.commitUpload);

  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<UiError | null>(null);
  const countdown = useWaitCountdown();
  const [imageId, setImageId] = useState<Id<"images"> | null>(null);
  const [deduplicated, setDeduplicated] = useState(false);
  const [dragging, setDragging] = useState(false);

  const busy = phase !== "idle";

  /**
   * Signing out unmounts the uploader. Without this the in-flight XHR would
   * keep sending the photo and its continuation would still call
   * `commitUpload`. Nulling the controller invalidates the attempt: every
   * `current()` check after an await then fails, so no later step runs and no
   * state is written after unmount. The countdown hook clears its own timer on
   * unmount.
   */
  useEffect(
    () => () => {
      const controller = abortRef.current;
      abortRef.current = null;
      controller?.abort();
      runningRef.current = false;
      attemptRef.current = null;
    },
    [],
  );

  function openFilePicker() {
    const input = inputRef.current;
    if (input === null) {
      return;
    }
    input.click();
    labelRef.current?.focus({ preventScroll: true });
  }

  async function run(attempt: Attempt) {
    if (runningRef.current) {
      return;
    }
    runningRef.current = true;
    attemptRef.current = attempt;
    const controller = new AbortController();
    abortRef.current = controller;
    const current = () => abortRef.current === controller;
    setError(null);
    countdown.clear();

    try {
      if (attempt.step === "hash") {
        setPhase("hashing");
        attempt.sha256 = await sha256Hex(attempt.file);
        if (!current()) {
          throw new UploadCancelledError();
        }
        attempt.step = "createUpload";
      }

      if (attempt.step === "createUpload") {
        setPhase("uploading");
        setProgress(0);
        const created = await createUpload({});
        if (!current()) {
          throw new UploadCancelledError();
        }
        attempt.uploadUrl = created.uploadUrl;
        attempt.expiresAt = created.expiresAt;
        attempt.step = "upload";
      }

      if (attempt.step === "upload") {
        if (attempt.uploadUrl === null) {
          throw new Error("Missing upload URL");
        }
        setPhase("uploading");
        attempt.storageId = (await uploadWithProgress(
          attempt.uploadUrl,
          attempt.file,
          setProgress,
          controller.signal,
        )) as Id<"_storage">;
        attempt.step = "commit";
      }

      if (attempt.step === "commit") {
        if (attempt.storageId === null || attempt.sha256 === null) {
          throw new Error("Missing upload details");
        }
        setPhase("committing");
        const result = await commitUpload({
          storageId: attempt.storageId,
          sha256: attempt.sha256,
          bytes: attempt.file.size,
          mime: attempt.file.type,
        });
        if (!current()) {
          return;
        }
        setImageId(result.id);
        setDeduplicated(result.deduplicated);
        attemptRef.current = null;
      }

      setProgress(0);
      setPhase("idle");
    } catch (cause) {
      // A cancel already reset the UI; the async tail must not overwrite it.
      if (!current()) {
        return;
      }
      setPhase("idle");
      setProgress(0);
      if (cause instanceof UploadCancelledError) {
        attemptRef.current = null;
        return;
      }
      if (cause instanceof UploadUrlExpiredError) {
        // Retry from a fresh URL: `attemptForRetry` reads `expiresAt`.
        attempt.expiresAt = 0;
        attempt.uploadUrl = null;
        attempt.storageId = null;
        attempt.step = "createUpload";
        attemptRef.current = attempt;
      }
      const ui = toUiError(cause);
      setError(ui);
      if (ui.action === "wait") {
        countdown.start(ui.retryAfterMs ?? 0);
      }
    } finally {
      if (current()) {
        abortRef.current = null;
        runningRef.current = false;
      }
    }
  }

  function cancel() {
    const controller = abortRef.current;
    abortRef.current = null;
    controller?.abort();
    attemptRef.current = null;
    runningRef.current = false;
    setPhase("idle");
    setProgress(0);
    setError(null);
    countdown.clear();
  }

  function begin(file: File) {
    if (runningRef.current) {
      return;
    }

    setImageId(null);
    setDeduplicated(false);
    setProgress(0);
    countdown.clear();
    attemptRef.current = null;

    const rejection = precheck(file);
    if (rejection !== null) {
      setError(rejection);
      return;
    }

    setError(null);
    void run({
      file,
      step: "hash",
      sha256: null,
      uploadUrl: null,
      storageId: null,
      expiresAt: null,
    });
  }

  function retry() {
    const attempt = attemptRef.current;
    if (attempt === null) {
      return;
    }
    void run(attemptForRetry(attempt, error));
  }

  function handleFileInput(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file !== undefined) {
      begin(file);
    }
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (busy) {
      return;
    }
    const file = event.dataTransfer.files[0];
    if (file !== undefined) {
      begin(file);
    }
  }

  function handlePanelClick(event: React.MouseEvent<HTMLDivElement>) {
    if (busy || (event.target as HTMLElement).closest("label") !== null) {
      return;
    }
    openFilePicker();
  }

  function errorAction() {
    if (error === null) {
      return null;
    }

    if (error.action === "wait") {
      if (countdown.waiting) {
        return (
          <p
            role="status"
            aria-live="polite"
            className="text-xs text-muted-foreground"
          >
            {formatRetryAfter(countdown.remainingMs)}
          </p>
        );
      }
      return (
        <Button type="button" variant="outline" onClick={retry}>
          {UPLOAD_COPY.retry}
        </Button>
      );
    }
    if (error.action === "change-file") {
      return (
        <Button type="button" variant="outline" onClick={openFilePicker}>
          {UPLOAD_COPY.changeFile}
        </Button>
      );
    }
    if (error.action === "retry") {
      return (
        <Button type="button" variant="outline" onClick={retry}>
          {UPLOAD_COPY.retry}
        </Button>
      );
    }
    if (error.action === "sign-in") {
      return (
        <Button
          type="button"
          onClick={() => router.push(signInPath("/app"))}
        >
          {UPLOAD_COPY.signIn}
        </Button>
      );
    }
    return null;
  }

  const progressLabel =
    phase === "hashing"
      ? UPLOAD_COPY.hashing
      : phase === "committing"
        ? UPLOAD_COPY.committing
        : UPLOAD_COPY.uploadingPercent(progress);

  return (
    <section aria-labelledby="uploader-heading" className="min-w-0">
      <div
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          if (!busy) {
            setDragging(true);
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) {
            setDragging(false);
          }
        }}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          id="photo-upload"
          name="photo"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={handleFileInput}
          className="peer sr-only"
        />
        <div
          onClick={handlePanelClick}
          className={[
            "group relative flex cursor-pointer flex-col gap-5 overflow-hidden rounded-3xl bg-ink p-5 text-paper ring-1 ring-transparent transition-[transform,box-shadow] duration-300 ease-out hover:shadow-lift dark:ring-paper/10 sm:flex-row sm:items-center sm:justify-between sm:gap-8 sm:p-6",
            "peer-focus-visible:ring-4 peer-focus-visible:ring-ring/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
            dragging ? "scale-[1.01] shadow-lift ring-4 ring-lamp" : "",
            busy ? "cursor-not-allowed opacity-60" : "",
          ].join(" ")}
        >
          <div className="min-w-0 space-y-1.5 sm:max-w-xl">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className={[
                  "size-3 shrink-0 rounded-full bg-lamp",
                  busy ? "opacity-40" : "lamp",
                ].join(" ")}
              />
              <h1
                id="uploader-heading"
                className="font-display text-2xl font-extrabold text-paper sm:text-3xl"
              >
                {UPLOAD_COPY.heading}
              </h1>
            </div>
            <p className="max-w-md pl-6 text-sm text-paper/75 sm:text-base">
              {UPLOAD_COPY.intro}
            </p>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:shrink-0 sm:items-end sm:text-right">
            <label
              ref={labelRef}
              htmlFor="photo-upload"
              aria-disabled={busy}
              tabIndex={-1}
              className={[
                "press inline-flex h-12 w-full cursor-pointer items-center justify-center rounded-full bg-lamp px-6 text-base font-bold text-ink group-hover:-translate-y-px sm:h-11 sm:w-auto sm:text-sm",
                busy ? "cursor-not-allowed" : "",
              ].join(" ")}
            >
              {UPLOAD_COPY.choosePhoto}
            </label>
            <span className="hidden text-sm text-paper/75 pointer-fine:inline">
              {dragging ? UPLOAD_COPY.dropActive : UPLOAD_COPY.dropHint}
            </span>
            <span className="text-xs text-paper/70 sm:text-sm">
              {UPLOAD_COPY.formats}
            </span>
          </div>
        </div>
      </div>

      {busy ? (
        <div className="mt-4 space-y-2">
          <div className="space-y-2" role="status" aria-live="polite">
            <p className="text-sm">{progressLabel}</p>
            {phase === "uploading" ? (
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
                aria-label={UPLOAD_COPY.uploading}
                className="h-2 w-full overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none"
                  style={{ width: `${progress}%` }}
                />
              </div>
            ) : null}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={cancel}>
            {UPLOAD_COPY.cancel}
          </Button>
        </div>
      ) : null}

      {error !== null ? (
        <div
          role="alert"
          className="mt-4 space-y-3 rounded-2xl border border-destructive/30 bg-destructive/8 p-4"
        >
          <p className="text-sm text-destructive">{error.message}</p>
          {errorAction()}
        </div>
      ) : null}

      {imageId !== null ? (
        <div className="mt-4 space-y-3 rounded-2xl border border-border bg-card p-4 shadow-lift sm:p-5">
          {deduplicated ? (
            <p role="status" className="text-sm">
              {UPLOAD_COPY.deduplicated}
            </p>
          ) : null}
          <LiveScore imageId={imageId} onChangeFile={openFilePicker} />
        </div>
      ) : null}
    </section>
  );
}