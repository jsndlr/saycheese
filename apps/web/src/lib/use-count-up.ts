"use client";

import { useEffect, useRef } from "react";

/**
 * Counts the text of a numeral up from zero once, after mount.
 *
 * The element renders its final value on the server and in tests; the effect only
 * rewrites that same text node, so nothing re-renders and nothing is lost when
 * scripts or animation are unavailable. Reduced motion keeps the final value.
 */
export function useCountUp(value: number, { duration = 1000, delay = 0 } = {}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = ref.current?.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    if (
      typeof window.matchMedia !== "function" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const final = String(value);
    const startAt = performance.now() + delay;
    let frame = 0;
    node.nodeValue = "0";

    const tick = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - startAt) / duration));
      const eased = 1 - Math.pow(1 - progress, 4);
      node.nodeValue = progress >= 1 ? final : String(Math.round(eased * value));
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      node.nodeValue = final;
    };
  }, [value, duration, delay]);

  return ref;
}
