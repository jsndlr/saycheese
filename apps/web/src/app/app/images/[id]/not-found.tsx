import Link from "next/link";

import { IMAGE_DETAIL_COPY } from "@/lib/copy";

export default function ImageNotFound() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
      <h1 className="mb-3 text-4xl font-extrabold">
        {IMAGE_DETAIL_COPY.notFoundHeading}
      </h1>
      <p className="mb-6 text-muted-foreground">
        {IMAGE_DETAIL_COPY.notFound}
      </p>
      <Link
        href="/app"
        className="press inline-flex h-11 items-center rounded-full bg-foreground px-6 text-sm font-semibold text-background hover:-translate-y-px hover:shadow-lift"
      >
        {IMAGE_DETAIL_COPY.back}
      </Link>
    </div>
  );
}
