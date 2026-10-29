"use client";

import { useEffect, useState } from "react";

/**
 * One-second countdown shared by the uploader's rate-limit wait and the score
 * panel's rescore wait. The tick chain stops as soon as the deadline passes, so
 * no timer keeps running behind a settled panel.
 */
export function useWaitCountdown() {
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [clock, setClock] = useState(0);

  useEffect(() => {
    if (waitUntil === null || clock >= waitUntil) {
      return;
    }
    const timer = setTimeout(() => setClock(Date.now()), 1_000);
    return () => clearTimeout(timer);
  }, [clock, waitUntil]);

  const waiting = waitUntil !== null && clock < waitUntil;

  return {
    waiting,
    remainingMs: waiting ? waitUntil - clock : 0,
    start(ms: number) {
      const now = Date.now();
      setClock(now);
      setWaitUntil(now + Math.max(0, ms));
    },
    clear() {
      setWaitUntil(null);
    },
  };
}