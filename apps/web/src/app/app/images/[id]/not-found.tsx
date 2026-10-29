import Link from "next/link";

import { IMAGE_DETAIL_COPY } from "@/lib/copy";

export default function ImageNotFound() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-semibold">
        {IMAGE_DETAIL_COPY.notFoundHeading}
      </h1>
      <p className="mb-4 text-sm text-muted-foreground">
        {IMAGE_DETAIL_COPY.notFound}
      </p>
      <Link
        href="/app"
        className="text-sm underline underline-offset-4 hover:text-foreground"
      >
        {IMAGE_DETAIL_COPY.back}
      </Link>
    </div>
  );
}
