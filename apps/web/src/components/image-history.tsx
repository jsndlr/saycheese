"use client";

import { api } from "@saycheese/backend/convex/_generated/api";
import type { ImageDto } from "@saycheese/backend/convex/model/images";
import { Button } from "@saycheese/ui/components/button";
import { preloadedQueryResult } from "convex/nextjs";
import type { Preloaded } from "convex/react";
import { usePaginatedQuery, useQuery } from "convex/react";
import type { Route } from "next";
import Link from "next/link";

import { AuthGate } from "@/components/auth-gate";
import { LocalTime, useTimeLabel } from "@/components/local-time";
import { HISTORY_COPY, SCORE_COPY, UPLOAD_COPY } from "@/lib/copy";

const PAGE_SIZE = 12;

type ChipTone = "neutral" | "active" | "done" | "failed";

const CHIP_TONES: Record<ChipTone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  active: "border-transparent bg-accent text-accent-foreground",
  done: "border-success/30 bg-success/12 text-success",
  failed: "border-destructive/30 bg-destructive/10 text-destructive",
};

function chipFor(image: ImageDto): { label: string; tone: ChipTone } {
  if (image.status === "failed") {
    return { label: HISTORY_COPY.status.failed, tone: "failed" };
  }

  if (image.status === "scored") {
    switch (image.score?.status) {
      case "no_face":
        return { label: HISTORY_COPY.status.noFace, tone: "neutral" };
      case "multiple_faces":
        return { label: HISTORY_COPY.status.multipleFaces, tone: "neutral" };
      case "low_quality":
        return { label: HISTORY_COPY.status.lowQuality, tone: "neutral" };
      case "unavailable":
        return { label: HISTORY_COPY.status.unavailable, tone: "neutral" };
      case "scored":
      default:
        return { label: HISTORY_COPY.status.scored, tone: "done" };
    }
  }

  if (image.status === "scoring") {
    return { label: HISTORY_COPY.status.scoring, tone: "active" };
  }
  if (image.status === "uploaded") {
    return { label: HISTORY_COPY.status.uploaded, tone: "neutral" };
  }
  return { label: HISTORY_COPY.status.processing, tone: "active" };
}

function Thumbnail({ id, alt, score }: { id: ImageDto["id"]; alt: string; score: number | null }) {
  const file = useQuery(api.queries.images.fileUrl, { id, variant: "preview" });

  return (
    <PrintImage alt={alt} score={score} url={file?.url ?? null} />
  );
}

/**
 * The picture half of a print: a square crop with the score printed in its
 * corner, the same ink-and-lamp pairing as a frame on the landing strip.
 */
function PrintImage({
  alt,
  score,
  url,
}: {
  alt: string;
  score: number | null;
  url: string | null;
}) {
  return (
    <div className="relative aspect-square overflow-hidden rounded-[2px] bg-muted">
      {url ? (
        <img
          src={url}
          width={256}
          height={256}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04] motion-reduce:transition-none"
        />
      ) : null}
      {score !== null ? (
        <span className="num absolute bottom-2 left-2 rounded-[3px] bg-ink px-2 py-1 font-display text-2xl leading-none font-extrabold text-lamp">
          {score}
          <span className="sr-only"> {SCORE_COPY.scoreSuffix}</span>
        </span>
      ) : null}
    </div>
  );
}

/**
 * `live` is false only for the server/preloaded branch, which must not open a
 * `fileUrl` subscription before auth resolves. The square is still reserved, so
 * the picture arriving later cannot shift the print.
 */
function HistoryRow({ image, live }: { image: ImageDto; live: boolean }) {
  const uploaded = useTimeLabel(image.createdAt, "relative");
  const chip = chipFor(image);
  const score = image.score;
  const value = score?.score ?? null;

  return (
    <li>
      <Link
        href={`/app/images/${image.id}` as Route}
        className="press group block rounded-[3px] bg-card p-2 pb-3 shadow-lift transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-0.5 focus-visible:ring-4 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {live ? (
          <Thumbnail id={image.id} alt={HISTORY_COPY.thumbnailAlt(uploaded)} score={value} />
        ) : (
          <PrintImage alt="" score={value} url={null} />
        )}
        <div className="mt-2.5 space-y-1.5 px-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${CHIP_TONES[chip.tone]}`}
            >
              {chip.label}
            </span>
            {score?.cached ? (
              <span className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                {HISTORY_COPY.cached}
              </span>
            ) : null}
          </div>
          <LocalTime
            value={image.createdAt}
            mode="relative"
            className="block text-sm text-muted-foreground"
          />
        </div>
      </Link>
    </li>
  );
}

function SkeletonRow() {
  return (
    <li aria-hidden="true" className="rounded-[3px] bg-card p-2 pb-3 shadow-lift motion-safe:animate-pulse">
      <div className="aspect-square rounded-[2px] bg-muted" />
      <div className="mt-2.5 space-y-2 px-1">
        <div className="h-5 w-20 rounded-full bg-muted" />
        <div className="h-3.5 w-14 rounded-full bg-muted" />
      </div>
    </li>
  );
}

const GRID = "grid grid-cols-2 gap-3.5 sm:grid-cols-3 sm:gap-5 min-[900px]:grid-cols-2 min-[1180px]:grid-cols-3";

function HistoryRows({ images, live }: { images: ImageDto[]; live: boolean }) {
  return (
    <ul className={GRID}>
      {images.map((image) => (
        <HistoryRow key={image.id} image={image} live={live} />
      ))}
    </ul>
  );
}

/**
 * The preloaded branch of the list: rows from the server payload, no Convex
 * subscription, so it is safe to paint before auth resolves.
 */
function PreloadedHistory({
  preloaded,
}: {
  preloaded?: Preloaded<typeof api.queries.images.list> | null;
}) {
  const page =
    preloaded === undefined || preloaded === null
      ? null
      : preloadedQueryResult(preloaded);

  return (
    <section aria-labelledby="history-heading" className="min-w-0">
      <h2 id="history-heading" className="mb-3 font-display text-3xl font-extrabold sm:mb-5">
        {UPLOAD_COPY.historyHeading}
      </h2>
      {page === null ? null : <HistoryRows images={page.page} live={false} />}
    </section>
  );
}

function LiveHistory({
  preloaded,
}: {
  preloaded?: Preloaded<typeof api.queries.images.list> | null;
}) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.queries.images.list,
    {},
    { initialNumItems: PAGE_SIZE },
  );

  const preloadedPage =
    preloaded === undefined || preloaded === null
      ? null
      : preloadedQueryResult(preloaded);
  const loadingFirstPage = status === "LoadingFirstPage" && results.length === 0;
  // The first page arrives from the server. Until the client subscription
  // delivers the same page, paint the preloaded rows instead of a skeleton so
  // the handover has nothing to shift.
  const images = loadingFirstPage && preloadedPage ? preloadedPage.page : results;

  return (
    <section aria-labelledby="history-heading" className="min-w-0">
      <h2 id="history-heading" className="mb-3 font-display text-3xl font-extrabold sm:mb-5">
        {UPLOAD_COPY.historyHeading}
      </h2>

      {loadingFirstPage && images.length === 0 ? (
        <>
          <p role="status" className="sr-only">
            {HISTORY_COPY.loading}
          </p>
          <ul aria-busy="true" className={GRID}>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </ul>
        </>
      ) : images.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-input bg-muted/50 p-8 text-center text-muted-foreground">
          <div
            aria-hidden="true"
            className="mx-auto mb-5 aspect-[5/3] w-28 rounded-[3px] border-[3px] border-paper bg-ink shadow-lift"
          />
          {HISTORY_COPY.empty}
        </div>
      ) : (
        <>
          <HistoryRows images={images} live />
          {status === "CanLoadMore" ? (
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              onClick={() => loadMore(PAGE_SIZE)}
            >
              {HISTORY_COPY.loadMore}
            </Button>
          ) : status === "LoadingMore" ? (
            <p role="status" className="mt-3 text-xs text-muted-foreground">
              {HISTORY_COPY.loadingMore}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * The list owns its own gate as well as living inside AppView's: the history is
 * the one place that mounts a subscription per row, so losing the session must
 * unmount it here even if a future page renders the list outside `/app`.
 */
export function ImageHistory({
  preloaded,
  next,
}: {
  preloaded?: Preloaded<typeof api.queries.images.list> | null;
  next: string;
}) {
  return (
    <AuthGate next={next} fallback={<PreloadedHistory preloaded={preloaded} />}>
      <LiveHistory preloaded={preloaded} />
    </AuthGate>
  );
}
