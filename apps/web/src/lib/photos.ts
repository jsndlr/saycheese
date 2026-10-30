import type { MouseEvent } from "react";

export const PHOTOS_ID = "photos";
export const PHOTOS_HREF = "/app#photos";

/** Modified and non-primary clicks keep native browser behavior. */
export function isPlainNavigationClick(event: {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

/** Scroll to the collection and focus its heading (which carries scroll margin). */
export function scrollToPhotos(behavior: ScrollBehavior = "smooth"): boolean {
  const target = document.getElementById(PHOTOS_ID);
  if (target === null) {
    return false;
  }

  const reduced =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  target.scrollIntoView({
    behavior: reduced ? "auto" : behavior,
    block: "start",
  });
  target.focus({ preventScroll: true });
  return true;
}

/** A same-route `#photos` link does not re-scroll, so move focus after the menu closes. */
export function handlePhotosLinkClick(
  pathname: string,
  event: MouseEvent<HTMLAnchorElement>,
): void {
  if (pathname !== "/app" || !isPlainNavigationClick(event)) {
    return;
  }
  window.setTimeout(() => {
    scrollToPhotos();
  }, 0);
}
