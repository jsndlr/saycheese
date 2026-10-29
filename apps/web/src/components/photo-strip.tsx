"use client";

import type { CSSProperties } from "react";

import { useCountUp } from "@/lib/use-count-up";

/**
 * Four booth frames: the smile widens and the printed example score climbs.
 * These are authored demonstration values, labelled "Example scores" on the strip.
 */
const FRAMES = [
  { score: 12, mouth: "M54 72 Q80 74 106 72", teeth: null },
  { score: 41, mouth: "M48 66 Q80 84 112 66", teeth: null },
  { score: 78, mouth: "M40 60 Q80 98 120 60", teeth: null },
  {
    score: 97,
    mouth: "M34 54 Q80 112 126 54",
    teeth: "M43 59 Q80 104 117 59 Q80 78 43 59Z",
  },
] as const;

const FRAME_GAP_MS = 340;
const FIRST_FLASH_MS = 700;

function css(vars: Record<string, string>): CSSProperties {
  return vars as CSSProperties;
}

function Frame({
  index,
  score,
  mouth,
  teeth,
}: {
  index: number;
  score: number;
  mouth: string;
  teeth: string | null;
}) {
  const flashAt = FIRST_FLASH_MS + index * FRAME_GAP_MS;
  const scoreRef = useCountUp(score, { duration: 1000, delay: flashAt + 260 });

  return (
    <div
      className="frame-flash relative aspect-[5/3] overflow-hidden bg-ink"
      style={css({ "--flash-delay": `${flashAt}ms` })}
    >
      <svg
        viewBox="0 0 160 96"
        fill="none"
        aria-hidden="true"
        className="frame-content absolute inset-0 size-full"
        style={css({ "--content-delay": `${flashAt + 140}ms` })}
      >
        {teeth ? <path d={teeth} className="fill-paper" /> : null}
        <path
          d={mouth}
          strokeWidth="7"
          strokeLinecap="round"
          className="stroke-[oklch(0.7_0.2_28)]"
        />
      </svg>
      <span
        className="score-land num absolute bottom-2 left-3 font-display text-2xl leading-none font-extrabold text-lamp"
        style={css({ "--land-delay": `${flashAt + 260}ms` })}
      >
        <span ref={scoreRef}>{score}</span>
      </span>
    </div>
  );
}

/** The hero object: a booth slot, a lamp, and a strip that prints out of it. */
export function PhotoStrip({ className }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label="An example photo strip. Across four frames the smile widens and the example score rises from 12 to 97."
      className={className}
    >
      <div className="relative mx-auto w-[min(16rem,66vw)]">
        <div
          aria-hidden="true"
          className="relative z-10 -mx-4 flex h-12 items-center justify-center rounded-2xl bg-ink shadow-lift"
        >
          <span className="lamp absolute top-1/2 left-5 size-2.5 -translate-y-1/2 rounded-full bg-lamp" />
          <span className="h-2.5 w-[58%] rounded-full bg-black shadow-[inset_0_2px_3px_rgb(0_0_0/0.9)]" />
          <span className="absolute top-1/2 right-5 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-paper/25" />
        </div>

        <div
          aria-hidden="true"
          className="strip-print strip-paper relative z-0 -mt-1 flex origin-top flex-col gap-2.5 px-3.5 pt-5 pb-3"
          style={css({ "--strip-tilt": "-2.2deg" })}
        >
          {FRAMES.map((frame, index) => (
            <Frame key={frame.score} index={index} {...frame} />
          ))}
          <div className="flex items-baseline justify-between pt-1 text-ink">
            <p className="font-display text-sm font-extrabold tracking-tight">saycheese</p>
            <p className="text-[0.6875rem] font-medium text-ink/65">Example scores</p>
          </div>
        </div>
      </div>
    </div>
  );
}
