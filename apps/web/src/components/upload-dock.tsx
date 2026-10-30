"use client";

import { useEffect, useState } from "react";

import { UPLOAD_COPY } from "@/lib/copy";

/**
 * Phone-only shortcut: once the uploader has scrolled away, the next upload is
 * still one thumb tap. It opens the uploader's own file input, so there is a
 * single upload path (and a disabled input, while a photo is busy, stays inert).
 */
function uploaderSection() {
  return document.getElementById("uploader-heading")?.closest("section") ?? null;
}

function openPicker() {
  // Progress, errors and the result render inside the uploader, so bring it
  // back on screen as the picker opens.
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  uploaderSection()?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  document.getElementById("photo-upload")?.click();
}

export function UploadDock() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const target = uploaderSection();
    if (!target || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(!entry.isIntersecting);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      aria-hidden={!visible}
      inert={!visible}
      className={[
        "fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:hidden",
        "transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none",
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={openPicker}
        className="press flex h-13 w-full cursor-pointer items-center justify-center rounded-full bg-ink text-base font-bold text-lamp shadow-lift focus-visible:ring-4 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
      >
        {UPLOAD_COPY.choosePhoto}
      </button>
    </div>
  );
}
