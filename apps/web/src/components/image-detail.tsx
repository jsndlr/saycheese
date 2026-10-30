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
import { PhotoNotFound } from "@/components/photo-not-found";
import { ScorePanel } from "@/components/score-panel";
import { signInPath } from "@/lib/auth-path";
import { IMAGE_DETAIL_COPY } from "@/lib/copy";
import { toUiError, type UiError } from "@/lib/errors";
import { isImageNotFoundError } from "@/lib/image-not-found";
import { PHOTOS_HREF } from "@/lib/photos";

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
      router.push(PHOTOS_HREF);
      toast.success(IMAGE_DETAIL_COPY.archivedToast);
    } catch (cause) {
      const failure = toUiError(cause);
      // A retry after a lost response finds the row already archived. That is
      // the outcome the caller asked for, not an error.
      if (failure.code === "NOT_FOUND") {
        router.push(PHOTOS_HREF);
        toast.success(IMAGE_DETAIL_COPY.archivedToast);
        return;
      }
      suspend?.(false);
      setError(failure);
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
          {error.action === "sign-in" ? (
            <>
              {" "}
              <Link href={signInPath("/app")} className="font-semibold underline">
                {IMAGE_DETAIL_COPY.signIn}
              </Link>
            </>
          ) : null}
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
    <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-10">
      <Link
        href={PHOTOS_HREF}
        className="press -ml-3 inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        ← {IMAGE_DETAIL_COPY.back}
      </Link>
      <h1 className="mt-3 mb-6 text-3xl font-extrabold sm:mt-4 sm:mb-8 sm:text-5xl">
        {IMAGE_DETAIL_COPY.heading}
      </h1>

      <div className="grid grid-cols-1 gap-8 min-[900px]:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] min-[900px]:gap-10">
        <ScorePanel
          image={image}
          previewUrl={previewUrl}
          onChangeFile={() => router.push("/app")}
        />

        <div className="space-y-6 self-start border-t border-border pt-6 min-[900px]:border-t-0 min-[900px]:border-l min-[900px]:pt-0 min-[900px]:pl-10">
          <dl className="divide-y divide-border text-sm">
            <div className="pb-3">
              <dt className="text-xs font-medium text-muted-foreground">
                {IMAGE_DETAIL_COPY.uploaded}
              </dt>
              <dd className="mt-1 text-base font-medium">
                <LocalTime value={image.createdAt} />
              </dd>
            </div>
            <div className="py-3">
              <dt className="text-xs font-medium text-muted-foreground">
                {IMAGE_DETAIL_COPY.dimensions}
              </dt>
              <dd className="mt-1 text-base font-medium">
                {image.width !== null && image.height !== null
                  ? IMAGE_DETAIL_COPY.dimensionsValue(image.width, image.height)
                  : IMAGE_DETAIL_COPY.unknownValue}
              </dd>
            </div>
            <div className="pt-3">
              <dt className="text-xs font-medium text-muted-foreground">
                {IMAGE_DETAIL_COPY.size}
              </dt>
              <dd className="mt-1 text-base font-medium">{formatBytes(image.bytes)}</dd>
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
    return <PhotoNotFound />;
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
