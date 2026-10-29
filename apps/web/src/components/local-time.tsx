"use client";

import { useSyncExternalStore } from "react";

import {
  formatLocalTime,
  formatRelativeTime,
  formatUtc,
} from "@/lib/relative-time";

const TICK_MS = 30_000;

/**
 * One clock shared by every mounted time label. The snapshot starts at module
 * load and only changes on a tick, so `getSnapshot` stays stable between
 * renders; the server snapshot is `null`, which is what makes the first client
 * render match the server's UTC fallback.
 */
let clock = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick() {
  clock = Date.now();
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  if (timer === null) {
    timer = setInterval(tick, TICK_MS);
    // Refresh on mount: a chunk can be evaluated long before it renders, and
    // the clock must not lag behind the page by a whole tick.
    tick();
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): number {
  return clock;
}

function getServerSnapshot(): null {
  return null;
}

export type TimeMode = "absolute" | "relative";

/**
 * The label alone, for places that need the text without a `<time>` element.
 * `useSyncExternalStore` returns `null` until the browser mounts, so callers
 * can render the same `formatUtc` fallback the server did.
 */
export function useTimeLabel(value: number, mode: TimeMode = "absolute"): string {
  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (now === null) {
    return formatUtc(value);
  }
  return mode === "relative"
    ? formatRelativeTime(value, now)
    : formatLocalTime(value);
}

/**
 * Server-rendered times are always UTC with an explicit label; once mounted,
 * the browser's locale and timezone take over. No `suppressHydrationWarning`:
 * both sides render the same fallback first.
 */
export function LocalTime({
  value,
  mode = "absolute",
  className,
}: {
  value: number;
  mode?: TimeMode;
  className?: string;
}) {
  return (
    <time dateTime={new Date(value).toISOString()} className={className}>
      {useTimeLabel(value, mode)}
    </time>
  );
}
