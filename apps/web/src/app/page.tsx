import Link from "next/link";
import type { CSSProperties } from "react";

import { PhotoStrip } from "@/components/photo-strip";
import { isAuthenticated } from "@/lib/auth-server";

const STEPS = [
  {
    title: "Drop in a selfie",
    body: "JPEG, PNG or WebP, up to 8 MB. HEIC photos need a quick export to JPEG first.",
  },
  {
    title: "We check the face",
    body: "One clear face gets scored. No face, or a group shot, gets a plain answer instead of a number.",
  },
  {
    title: "Read the result",
    body: "A smile score from 0 to 100 with a short reason, saved in your history so you can compare takes.",
  },
] as const;

const FACTS = [
  {
    term: "A fun estimate",
    detail:
      "The score is an automated estimate of the smile in the photo. It is not a judgement of you.",
  },
  {
    term: "No location data",
    detail: "The copies we keep and show back have GPS and camera details removed.",
  },
  {
    term: "Archive when you like",
    detail:
      "Archived photos leave your history right away, and their files are deleted after 30 days.",
  },
] as const;

function delay(ms: number): CSSProperties {
  return { "--rise-delay": `${ms}ms` } as CSSProperties;
}

const primaryAction =
  "press inline-flex h-13 items-center rounded-full bg-lamp px-8 text-base font-bold text-ink hover:-translate-y-px hover:shadow-lift focus-visible:outline-curtain-foreground";

export default async function Home() {
  // Signed-in visitors are past sign-up: send them straight to the booth.
  const signedIn = await isAuthenticated();

  return (
    <>
      <section className="curtain relative overflow-hidden">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-8 sm:px-6 sm:py-12 lg:min-h-[calc(100svh-4rem)] lg:grid-cols-[1.15fr_0.85fr] lg:gap-8 lg:py-8">
          <div className="max-w-xl lg:max-w-none">
            <h1
              className="rise text-[clamp(3rem,8.2vw,6rem)] leading-[0.92] font-extrabold tracking-[-0.035em] text-curtain-foreground"
              style={delay(0)}
            >
              <span className="block">Say cheese.</span>
              <span className="block">Get a score.</span>
            </h1>
            <p
              className="rise mt-6 max-w-md text-lg leading-relaxed text-curtain-foreground/90"
              style={delay(120)}
            >
              Upload a selfie. We check there is a face, rate the smile from 0 to 100, and tell
              you how we got there.
            </p>
            <div className="rise mt-8 flex flex-wrap items-center gap-3" style={delay(220)}>
              <Link href={signedIn ? "/app" : "/sign-up"} className={primaryAction}>
                {signedIn ? "Open the booth" : "Score my smile"}
              </Link>
              {signedIn ? null : (
                <Link
                  href="/sign-in"
                  className="press inline-flex h-13 items-center rounded-full px-7 text-base font-semibold text-curtain-foreground ring-1 ring-curtain-foreground/45 hover:bg-curtain-foreground/10 focus-visible:outline-curtain-foreground"
                >
                  Sign in
                </Link>
              )}
            </div>
            <p
              className="rise mt-6 max-w-sm text-sm leading-relaxed text-curtain-foreground/85"
              style={delay(320)}
            >
              A fun estimate from software. It rates the smile in the photo, never the person.
            </p>
          </div>

          <PhotoStrip className="pb-8 lg:justify-self-center" />
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:py-28">
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
          <h2 className="text-4xl leading-[1.02] font-extrabold tracking-tight sm:text-5xl lg:sticky lg:top-28 lg:self-start">
            How a photo becomes a score
          </h2>
          <ol className="divide-y divide-border border-y border-border">
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                className="reveal grid grid-cols-[3.5rem_1fr] gap-4 py-7 sm:grid-cols-[5rem_1fr]"
              >
                <span
                  aria-hidden="true"
                  className="num font-display text-5xl leading-none font-extrabold text-primary-text sm:text-6xl"
                >
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-xl font-bold">{step.title}</h3>
                  <p className="mt-1.5 max-w-prose text-muted-foreground">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-y border-border bg-muted/60">
        <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
          <h2 className="max-w-xl text-3xl leading-tight font-extrabold tracking-tight sm:text-4xl">
            Straight answers
          </h2>
          <dl className="mt-10 grid gap-10 md:grid-cols-3 md:gap-12">
            {FACTS.map((fact) => (
              <div key={fact.term} className="reveal">
                <dt className="font-display text-xl font-bold">{fact.term}</dt>
                <dd className="mt-2 max-w-sm text-muted-foreground">{fact.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="curtain">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-8 px-4 py-14 sm:px-6 sm:py-20 md:flex-row md:items-center md:justify-between lg:py-24">
          <h2 className="max-w-xl text-4xl leading-[0.95] font-extrabold tracking-[-0.03em] text-curtain-foreground sm:text-6xl">
            Your turn in the booth.
          </h2>
          <Link href={signedIn ? "/app" : "/sign-up"} className={primaryAction}>
            {signedIn ? "Open the booth" : "Score my smile"}
          </Link>
        </div>
      </section>
    </>
  );
}
