const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const LOCAL = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["week", 7 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
  ["second", 1],
];

/**
 * Relative labels are computed in the browser only. The server and the first
 * client render both use `formatUtc`, so hydration cannot straddle a unit
 * boundary.
 */
export function formatRelativeTime(timestamp: number, now: number): string {
  const seconds = Math.trunc((timestamp - now) / 1_000);

  for (const [unit, unitSeconds] of UNITS) {
    if (Math.abs(seconds) >= unitSeconds) {
      return RELATIVE.format(Math.trunc(seconds / unitSeconds), unit);
    }
  }

  return RELATIVE.format(0, "second");
}

/**
 * Timezone- and locale-neutral label used for server rendering and for the
 * first client render, so both sides produce identical text. The explicit
 * `UTC` label keeps the value honest for a reader in another timezone.
 */
export function formatUtc(timestamp: number): string {
  return `${new Date(timestamp).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * Browser locale and timezone. Only call after mount: the server has no
 * reliable zone, so its output would not match the client's.
 */
export function formatLocalTime(timestamp: number): string {
  return LOCAL.format(timestamp);
}
