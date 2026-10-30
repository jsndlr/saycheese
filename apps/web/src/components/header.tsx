"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { USER_MENU_COPY } from "@/lib/copy";
import { PHOTOS_HREF, handlePhotosLinkClick } from "@/lib/photos";

import { UserMenu } from "./user-menu";

function isActive(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

export default function Header() {
  const pathname = usePathname();
  const photosActive = isActive(pathname, "/app");

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-2 px-4 sm:h-16 sm:gap-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-8">
          <Link
            href="/"
            aria-label="saycheese home"
            className="press group flex min-h-11 items-center gap-2 rounded-full py-1 sm:gap-2.5 sm:pr-2"
          >
            <span
              aria-hidden="true"
              className="lamp size-3 rounded-full bg-lamp"
            />
            <span className="font-display text-xl font-extrabold tracking-tight">saycheese</span>
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 text-sm font-medium sm:flex">
            <Link
              href={PHOTOS_HREF}
              aria-current={photosActive ? "page" : undefined}
              onClick={(event) => handlePhotosLinkClick(pathname, event)}
              className={[
                "press relative inline-flex min-h-11 items-center rounded-full px-3.5 py-2 transition-colors",
                photosActive
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              ].join(" ")}
            >
              {USER_MENU_COPY.photos}
            </Link>
          </nav>
        </div>
        <UserMenu />
      </div>
    </header>
  );
}
