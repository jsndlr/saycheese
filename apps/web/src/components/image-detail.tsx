"use client";

import { api } from "@saycheese/backend/convex/_generated/api";
import type { ImageDto } from "@saycheese/backend/convex/model/images";
import { preloadedQueryResult } from "convex/nextjs";
import type { Preloaded } from "convex/react";
import { usePreloadedQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AuthGate } from "@/components/auth-gate";
import { LocalTime } from "@/components/local-time";
import { ScorePanel } from "@/components/score-panel";
import { IMAGE_DETAIL_COPY } from "@/lib/copy";

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function DetailContent({
  image,
  previewUrl,
}: {
  image: ImageDto;
  previewUrl: string | null;
}) {
  const router = useRouter();

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-8">
      <Link
        href="/app"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← {IMAGE_DETAIL_COPY.back}
      </Link>
      <h1 className="mt-4 mb-6 text-2xl font-semibold">
        {IMAGE_DETAIL_COPY.heading}
      </h1>

      <div className="grid grid-cols-1 gap-8 min-[720px]:grid-cols-2">
        <ScorePanel
          image={image}
          previewUrl={previewUrl}
          onChangeFile={() => router.push("/app")}
        />

        <dl className="space-y-3 self-start border border-border bg-card p-4 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">
              {IMAGE_DETAIL_COPY.uploaded}
            </dt>
            <dd>
              <LocalTime value={image.createdAt} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              {IMAGE_DETAIL_COPY.dimensions}
            </dt>
            <dd>
              {image.width !== null && image.height !== null
                ? IMAGE_DETAIL_COPY.dimensionsValue(image.width, image.height)
                : IMAGE_DETAIL_COPY.unknownValue}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              {IMAGE_DETAIL_COPY.size}
            </dt>
            <dd>{formatBytes(image.bytes)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function SubscribedDetail({
  preloaded,
  preloadedOriginal,
}: {
  preloaded: Preloaded<typeof api.queries.images.byId>;
  preloadedOriginal: Preloaded<typeof api.queries.images.fileUrl>;
}) {
  const image = usePreloadedQuery(preloaded);
  const original = usePreloadedQuery(preloadedOriginal);

  return (
    <DetailContent image={image} previewUrl={original.url} />
  );
}

/**
 * The detail page subscribes to both the row and its original URL. The gate
 * paints the server payload until auth resolves, then hands over to the live
 * subscriptions; a lost session unmounts them instead of letting them throw
 * AUTH_REQUIRED.
 */
export default function ImageDetail({
  preloaded,
  preloadedOriginal,
  next,
}: {
  preloaded: Preloaded<typeof api.queries.images.byId>;
  preloadedOriginal: Preloaded<typeof api.queries.images.fileUrl>;
  next: string;
}) {
  const initial = preloadedQueryResult(preloaded);
  const initialOriginal = preloadedQueryResult(preloadedOriginal);

  return (
    <AuthGate
      next={next}
      fallback={
        <DetailContent image={initial} previewUrl={initialOriginal.url} />
      }
    >
      <SubscribedDetail
        preloaded={preloaded}
        preloadedOriginal={preloadedOriginal}
      />
    </AuthGate>
  );
}
