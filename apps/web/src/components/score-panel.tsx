"use client";

import { api } from "@saycheese/backend/convex/_generated/api";
import type {
  ImageDto,
  ImageScoreDto,
} from "@saycheese/backend/convex/model/images";
import { Button } from "@saycheese/ui/components/button";
import { Loader2 } from "@saycheese/ui/lib/icons";
import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";

import { ConfirmButton } from "@/components/confirm-button";
import { LocalTime } from "@/components/local-time";
import { SCORE_COPY } from "@/lib/copy";
import { formatLocalTime } from "@/lib/relative-time";
import {
  formatRetryAfter,
  toUiError,
  type UiError,
} from "@/lib/errors";
import { useWaitCountdown } from "@/lib/use-wait-countdown";

function quotaResetAt(createdAt: number): number {
  const created = new Date(createdAt);
  return Date.UTC(
    created.getUTCFullYear(),
    created.getUTCMonth(),
    created.getUTCDate() + 1,
  );
}

/**
 * A quota window belongs to the score row. Revisiting an old row after its
 * window has ended must not claim a future reset, so the copy is derived from
 * `score.createdAt`, not from the current render time.
 */
function quotaResetCopy(score: ImageScoreDto, now = Date.now()): string {
  const resetAt = quotaResetAt(score.createdAt);
  return now >= resetAt
    ? SCORE_COPY.quotaResetPassed
    : SCORE_COPY.quotaReset(formatLocalTime(resetAt));
}

function scoreValue(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function confidencePercent(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

function scoreReason(score: ImageScoreDto): string {
  return score.reason.length > 0 ? score.reason : SCORE_COPY.unavailableFallback;
}

/**
 * The text a screen reader hears when an image reaches a terminal state. A
 * non-terminal image returns null and is not announced.
 */
function terminalAnnouncement(image: ImageDto): string | null {
  if (image.status === "failed") {
    return toUiError({ data: { code: image.failureCode ?? "INTERNAL" } }).message;
  }

  if (image.status !== "scored" || image.score === null) {
    return null;
  }

  const score = image.score;
  const value = score.score === null ? null : scoreValue(score.score);

  let announcement: string;
  switch (score.status) {
    case "scored":
      announcement =
        value === null ? SCORE_COPY.noScore : SCORE_COPY.announceScore(value);
      break;
    case "multiple_faces":
      announcement =
        value === null
          ? SCORE_COPY.noScore
          : SCORE_COPY.announceMultipleFaces(value, score.faceCount);
      break;
    case "no_face":
      announcement = SCORE_COPY.noFace;
      break;
    case "low_quality":
      announcement = scoreReason(score);
      break;
    case "unavailable":
      announcement = scoreReason(score);
      if (image.quotaExceeded) {
        announcement += ` ${quotaResetCopy(score)}`;
      }
      break;
  }

  if (score.cached) {
    announcement += ` ${SCORE_COPY.announceCached}`;
  }
  const confidence = confidencePercent(score.confidence);
  if (confidence !== null) {
    announcement += ` ${SCORE_COPY.announceConfidence(confidence)}`;
  }
  return announcement;
}

function Spinner() {
  return (
    <Loader2
      aria-hidden="true"
      className="size-4 animate-spin motion-reduce:hidden"
    />
  );
}

function ScoreMeta({ score }: { score: ImageScoreDto }) {
  const confidence = confidencePercent(score.confidence);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>{SCORE_COPY.scoredBy(SCORE_COPY.provider[score.provider])}</span>
      {confidence === null ? null : (
        <span>{SCORE_COPY.confidence(confidence)}</span>
      )}
      {score.cached ? (
        <span className="border border-border px-1.5 py-0.5 text-[0.6875rem] text-foreground">
          {SCORE_COPY.cached}
        </span>
      ) : null}
    </div>
  );
}

function Processing() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner />
      <p>{SCORE_COPY.checking}</p>
    </div>
  );
}

function Scoring() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner />
      <p>{SCORE_COPY.scoring}</p>
    </div>
  );
}

function BigScore({ score }: { score: number }) {
  return (
    <p className="flex items-baseline gap-1">
      <span className="text-5xl font-semibold tabular-nums">
        {scoreValue(score)}
      </span>
      <span className="text-sm text-muted-foreground">
        {SCORE_COPY.scoreSuffix}
      </span>
    </p>
  );
}

/**
 * An unavailable score can be retried in place. A quota row only offers the
 * action once its own window has reset; before that the reset time is the only
 * truthful thing to show. The live `byId` query flips the panel to `scoring`
 * when the mutation succeeds, so no local success state is needed.
 */
function Unavailable({
  image,
  score,
}: {
  image: ImageDto;
  score: ImageScoreDto;
}) {
  const rescore = useMutation(api.commands.images.rescore);
  const countdown = useWaitCountdown();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const resetAt = quotaResetAt(score.createdAt);
  const quotaBlocked = image.quotaExceeded && now < resetAt;

  // A panel left open across the reset must offer the action without waiting
  // for an unrelated render.
  useEffect(() => {
    if (!quotaBlocked) {
      return;
    }
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(1, resetAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [quotaBlocked, resetAt]);

  const canRescore = !quotaBlocked;
  const disabled = pending || countdown.waiting;

  async function run() {
    if (disabled) {
      return;
    }
    setPending(true);
    setError(null);
    countdown.clear();

    try {
      await rescore({ id: image.id });
    } catch (cause) {
      const ui = toUiError(cause);
      setError(ui);
      if (ui.action === "wait") {
        countdown.start(ui.retryAfterMs ?? 0);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <p className="text-sm">{scoreReason(score)}</p>
        {image.quotaExceeded ? (
          <p className="text-xs text-muted-foreground">
            {now >= resetAt ? (
              SCORE_COPY.quotaResetPassed
            ) : (
              <>
                {SCORE_COPY.quotaResetPrefix} <LocalTime value={resetAt} />.
              </>
            )}
          </p>
        ) : null}
      </div>

      {canRescore ? (
        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => void run()}
          >
            {SCORE_COPY.rescore}
          </Button>
          {error !== null ? (
            <div role="alert" className="space-y-1">
              <p className="text-sm">{error.message}</p>
              {error.action === "wait" && countdown.waiting ? (
                <p
                  role="status"
                  aria-live="polite"
                  className="text-xs text-muted-foreground"
                >
                  {formatRetryAfter(countdown.remainingMs)}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Forced rescore of a real result. Unlike the unavailable path this always
 * spends a rescore token, so it sits behind a confirmation step; the shared
 * `RATE_LIMITED` countdown keeps the button disabled until the window refills.
 */
function ScoreAgain({ image }: { image: ImageDto }) {
  const rescore = useMutation(api.commands.images.rescore);
  const countdown = useWaitCountdown();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  const disabled = pending || countdown.waiting;

  async function run() {
    if (disabled) {
      return;
    }
    setPending(true);
    setError(null);
    countdown.clear();

    try {
      await rescore({ id: image.id, force: true });
    } catch (cause) {
      const ui = toUiError(cause);
      setError(ui);
      if (ui.action === "wait") {
        countdown.start(ui.retryAfterMs ?? 0);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <ConfirmButton
        label={SCORE_COPY.scoreAgain}
        question={SCORE_COPY.scoreAgainQuestion}
        variant="outline"
        size="xs"
        disabled={countdown.waiting}
        pending={pending}
        onConfirm={() => void run()}
      />
      {error !== null ? (
        <div role="alert" className="space-y-1">
          <p className="text-sm">{error.message}</p>
          {error.action === "wait" && countdown.waiting ? (
            <p
              role="status"
              aria-live="polite"
              className="text-xs text-muted-foreground"
            >
              {formatRetryAfter(countdown.remainingMs)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ScoreResult({
  image,
  score,
  onChangeFile,
}: {
  image: ImageDto;
  score: ImageScoreDto;
  onChangeFile: () => void;
}) {
  switch (score.status) {
    case "scored":
      return (
        <div className="space-y-3">
          <div className="space-y-2">
            {score.score === null ? (
              <p className="text-sm">{SCORE_COPY.noScore}</p>
            ) : (
              <BigScore score={score.score} />
            )}
            <ScoreMeta score={score} />
          </div>
          <ScoreAgain image={image} />
        </div>
      );

    case "multiple_faces":
      return (
        <div className="space-y-3">
          <div className="space-y-2">
            {score.score === null ? null : <BigScore score={score.score} />}
            <p className="text-sm">
              {SCORE_COPY.multipleFaces(score.faceCount)}
            </p>
            <ScoreMeta score={score} />
          </div>
          <ScoreAgain image={image} />
        </div>
      );

    case "no_face":
      return (
        <div className="space-y-3">
          <p className="text-sm">{SCORE_COPY.noFace}</p>
          <ScoreAgain image={image} />
        </div>
      );

    case "low_quality":
      return (
        <div className="space-y-3">
          <p className="text-sm">{scoreReason(score)}</p>
          <ScoreAgain image={image} />
        </div>
      );

    case "unavailable":
      return <Unavailable image={image} score={score} />;
  }
}

function Failed({
  image,
  onChangeFile,
}: {
  image: ImageDto;
  onChangeFile: () => void;
}) {
  const error = toUiError({ data: { code: image.failureCode ?? "INTERNAL" } });

  return (
    <div className="space-y-3">
      <p className="text-sm">{error.message}</p>
      <Button type="button" variant="outline" onClick={onChangeFile}>
        {SCORE_COPY.changeFile}
      </Button>
    </div>
  );
}

/**
 * Identity of one terminal outcome. A rescore links a new score row (or a
 * different cached row), so the key changes even though the image id does not;
 * the same outcome is still announced only once.
 */
function outcomeKey(image: ImageDto): string | null {
  if (image.status === "failed") {
    return `${image.id}:failed`;
  }
  if (image.status !== "scored" || image.score === null) {
    return null;
  }
  return `${image.id}:${image.score.id}`;
}

export function ScorePanel({
  image,
  previewUrl,
  onChangeFile,
}: {
  image: ImageDto;
  previewUrl?: string | null;
  onChangeFile: () => void;
}) {
  const announcedFor = useRef<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const key = outcomeKey(image);
    if (key === null) {
      // A rescore returns the panel to `scoring`; clearing the guard here is
      // what lets the next result be announced.
      announcedFor.current = null;
      setAnnouncement("");
      return;
    }
    if (announcedFor.current === key) {
      return;
    }
    const next = terminalAnnouncement(image);
    if (next === null) {
      return;
    }
    announcedFor.current = key;
    setAnnouncement(next);
  }, [image]);

  const showPreview =
    previewUrl != null && image.width !== null && image.height !== null;

  return (
    <section
      aria-labelledby="score-panel-heading"
      className="min-w-0 space-y-4 border border-border bg-card p-4"
    >
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <h2 id="score-panel-heading" className="text-sm font-medium">
        {SCORE_COPY.panelHeading}
      </h2>

      {showPreview ? (
        <img
          src={previewUrl}
          width={image.width ?? undefined}
          height={image.height ?? undefined}
          alt={SCORE_COPY.previewAlt}
          className="h-auto max-w-full object-contain"
        />
      ) : null}

      {image.status === "uploaded" ||
      image.status === "processing" ||
      image.status === "ready" ? (
        <Processing />
      ) : image.status === "scoring" ? (
        <Scoring />
      ) : image.status === "failed" ? (
        <Failed image={image} onChangeFile={onChangeFile} />
      ) : image.status === "scored" && image.score !== null ? (
        <ScoreResult
          image={image}
          score={image.score}
          onChangeFile={onChangeFile}
        />
      ) : (
        <p className="text-sm">{SCORE_COPY.noScore}</p>
      )}
    </section>
  );
}