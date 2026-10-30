"use client";

import { api } from "@saycheese/backend/convex/_generated/api";
import type { Preloaded } from "convex/react";

import { useEffect } from "react";

import { AuthGate } from "@/components/auth-gate";
import { ImageHistory } from "@/components/image-history";
import { UploadDock } from "@/components/upload-dock";
import { Uploader } from "@/components/uploader";
import { scrollToPhotos } from "@/lib/photos";

function AppContent({
  preloadedImages,
}: {
  preloadedImages: Preloaded<typeof api.queries.images.list>;
}) {
  useEffect(() => {
    // A direct or cross-route `/app#photos` link must land on the collection
    // and leave focus there, not just change the URL.
    if (window.location.hash === "#photos") {
      scrollToPhotos("auto");
    }
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-6 pb-28 sm:px-6 sm:py-10">
      <Uploader />
      <ImageHistory preloaded={preloadedImages} next="/app" />
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
