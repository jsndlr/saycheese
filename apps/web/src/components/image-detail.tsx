"use client";

import { api } from "@saycheese/backend/convex/_generated/api";
import type { ImageDto } from "@saycheese/backend/convex/model/images";
import { preloadedQueryResult } from "convex/nextjs";
import type { Preloaded } from "convex/react";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Component, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";

import { AuthGate } from "@/components/auth-gate";
import { ConfirmButton } from "@/components/confirm-button";
import { LocalTime } from "@/components/local-time";
import { ScorePanel } from "@/components/score-panel";
import { IMAGE_DETAIL_COPY } from "@/lib/copy";
import { toUiError, type UiError } from "@/lib/errors";
import { isImageNotFoundError } from "@/lib/image-not-found";

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

function ArchiveAction({
  image,
  suspend,
}: {
  image: ImageDto;
  suspend?: (pending: boolean) => void;
}) {
  const router = useRouter();
  const archive = useMutation(api.commands.images.archive);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  // Mirrors the server's refusal: the pipeline still holds the row.
  const inPipeline =
    image.status === "uploaded" ||
    image.status === "processing" ||
    image.status === "scoring";

  async function run() {
    if (pending) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      // Convex can publish NOT_FOUND before the mutation promise resolves.
      flushSync(() => suspend?.(true));
      await archive({ id: image.id });
      router.push("/app");
      toast.success(IMAGE_DETAIL_COPY.archivedToast);
    } catch (cause) {
      suspend?.(false);
      setError(toUiError(cause));
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <ConfirmButton
        label={IMAGE_DETAIL_COPY.archive}
        question={IMAGE_DETAIL_COPY.archiveQuestion}
        pendingLabel={IMAGE_DETAIL_COPY.archivePending}
        variant="destructive"
        size="sm"
        disabled={inPipeline}
        disabledReason={
          inPipeline ? IMAGE_DETAIL_COPY.archiveBlocked : undefined
        }
        pending={pending}
        onConfirm={() => void run()}
      />
      {error === null ? null : (
        <p role="alert" className="text-sm">
          {error.message}
        </p>
      )}
    </div>
  );
}

function DetailContent({
  image,
  previewUrl,
  suspend,
}: {
  image: ImageDto;
  previewUrl: string | null;
  suspend?: (pending: boolean) => void;
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

        <div className="space-y-4 self-start border border-border bg-card p-4">
          <dl className="space-y-3 text-sm">
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
          <ArchiveAction image={image} suspend={suspend} />
        </div>
      </div>
    </div>
  );
}

class DetailBoundary extends Component<
  { children: ReactNode },
  { missing: boolean }
> {
  state = { missing: false };

  static getDerivedStateFromError(error: unknown) {
    if (!isImageNotFoundError(error)) throw error;
    return { missing: true };
  }

  render() {
    if (!this.state.missing) return this.props.children;
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-8">
        <h1 className="mb-2 text-2xl font-semibold">
          {IMAGE_DETAIL_COPY.notFoundHeading}
        </h1>
        <p className="mb-4 text-sm text-muted-foreground">
          {IMAGE_DETAIL_COPY.notFound}
        </p>
        <Link href="/app" className="text-sm underline underline-offset-4">
          {IMAGE_DETAIL_COPY.back}
        </Link>
      </div>
    );
  }
}

function SubscribedDetail({
  preloaded,
  preloadedOriginal,
}: {
  preloaded: Preloaded<typeof api.queries.images.byId>;
  preloadedOriginal: Preloaded<typeof api.queries.images.fileUrl>;
}) {
  const [suspended, setSuspended] = useState(false);
  const initial = preloadedQueryResult(preloaded);
  const initialOriginal = preloadedQueryResult(preloadedOriginal);
  const liveImage = useQuery(
    api.queries.images.byId,
    suspended ? "skip" : { id: initial.id },
  );
  const liveOriginal = useQuery(
    api.queries.images.fileUrl,
    suspended ? "skip" : { id: initial.id, variant: "original" },
  );
  const last = useRef({ image: initial, original: initialOriginal });
  if (!suspended) {
    last.current = {
      image: liveImage ?? last.current.image,
      original: liveOriginal ?? last.current.original,
    };
  }
  const { image, original } = last.current;

  return (
    <DetailContent
      image={image}
      previewUrl={original.url}
      suspend={setSuspended}
    />
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
      <DetailBoundary key={initial.id}>
        <SubscribedDetail
          preloaded={preloaded}
          preloadedOriginal={preloadedOriginal}
        />
      </DetailBoundary>
    </AuthGate>
  );
}
