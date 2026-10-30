"use client";

import { api } from "@saycheese/backend/convex/_generated/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@saycheese/ui/components/dropdown-menu";
import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useEffect } from "react";
import { toast } from "sonner";

import { ModeToggle } from "@/components/mode-toggle";
import { UPLOAD_COPY, USER_MENU_COPY } from "@/lib/copy";
import { resetSigningOut, signOutUser, useSigningOut } from "@/lib/sign-out";

const buttonClass =
  "press grid size-10 shrink-0 place-items-center rounded-full bg-ink font-display text-base font-extrabold text-lamp uppercase ring-1 ring-foreground/10 dark:ring-paper/30 focus-visible:ring-4 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none";

const THEMES = [
  { value: "light", label: USER_MENU_COPY.themeLight },
  { value: "dark", label: USER_MENU_COPY.themeDark },
  { value: "system", label: USER_MENU_COPY.themeSystem },
] as const;

function SignedInMenu() {
  const { theme, setTheme } = useTheme();
  const signingOut = useSigningOut();
  // Suspended while signing out, like the page's own subscriptions, so deleting
  // the session cannot re-run it unauthenticated.
  const me = useQuery(api.queries.me.current, signingOut ? "skip" : {});
  const email = me?.user.email ?? "";

  async function handleSignOut() {
    const error = await signOutUser();
    if (error !== null) {
      toast.error(error);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={USER_MENU_COPY.label}
        disabled={signingOut}
        className={buttonClass}
      >
        {email.slice(0, 1) || <span className="size-1.5 rounded-full bg-lamp" aria-hidden="true" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="space-y-0.5 px-3 py-2">
            <span className="block">{UPLOAD_COPY.signedInAs}</span>
            <span className="block max-w-56 truncate text-sm font-semibold text-foreground">
              {email}
            </span>
            {me ? <span className="block">{UPLOAD_COPY.release(me.release)}</span> : null}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/app" />} className="min-h-11">{USER_MENU_COPY.photos}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{USER_MENU_COPY.theme}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
            {THEMES.map(({ value, label }) => (
              <DropdownMenuRadioItem key={value} value={value} className="min-h-11">
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" className="min-h-11" onClick={() => void handleSignOut()}>
          {UPLOAD_COPY.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Account entry point: a menu once signed in, a plain link otherwise. */
export function UserMenu() {
  const { isAuthenticated, isLoading } = useConvexAuth();

  useEffect(() => {
    // The flag outlives the page (sign-in is a client navigation), so clear it
    // once the signed-out state has actually been reached.
    if (!isLoading && !isAuthenticated) {
      resetSigningOut();
    }
  }, [isAuthenticated, isLoading]);

  if (isLoading) {
    // Reserve the button's space so the header does not shift when auth resolves.
    return <span aria-hidden="true" className="size-10 shrink-0 rounded-full bg-muted" />;
  }
  if (!isAuthenticated) {
    // No account menu to hold the theme choice, so signed-out visitors keep a toggle.
    return (
      <div className="flex items-center gap-2">
        <ModeToggle />
        <Link
          href="/sign-in"
          className="press inline-flex h-10 shrink-0 items-center rounded-full bg-foreground px-4 text-sm font-semibold text-background"
        >
          {USER_MENU_COPY.signIn}
        </Link>
      </div>
    );
  }
  return <SignedInMenu />;
}
