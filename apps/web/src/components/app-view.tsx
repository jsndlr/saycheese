"use client";

import { api } from "@saycheese/backend/convex/_generated/api";
import type { Preloaded } from "convex/react";

import { AuthGate } from "@/components/auth-gate";
import { ImageHistory } from "@/components/image-history";
import { UploadDock } from "@/components/upload-dock";
import { Uploader } from "@/components/uploader";

function AppContent({
  preloadedImages,
}: {
  preloadedImages: Preloaded<typeof api.queries.images.list>;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-6 pb-28 sm:px-6 sm:py-10">
      <h1 className="sr-only">saycheese</h1>
      <div className="grid grid-cols-1 gap-10 min-[900px]:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] min-[900px]:gap-14">
        <Uploader />
        <ImageHistory preloaded={preloadedImages} next="/app" />
      </div>
      <UploadDock />
    </div>
  );
}

export default function AppView({
  preloadedImages,
}: {
  preloadedImages: Preloaded<typeof api.queries.images.list>;
}) {
  return (
    <AuthGate next="/app" fallback={<AppContent preloadedImages={preloadedImages} />}>
      <AppContent preloadedImages={preloadedImages} />
    </AuthGate>
  );
}
