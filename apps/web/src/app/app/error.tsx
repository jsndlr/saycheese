"use client";

import { Button } from "@saycheese/ui/components/button";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { toUiError } from "@/lib/errors";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const authRequired = toUiError(error).code === "AUTH_REQUIRED";

  useEffect(() => {
    if (authRequired) {
      router.replace("/sign-in?next=/app");
    }
  }, [authRequired, router]);

  if (authRequired) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
        <p className="text-muted-foreground">Redirecting to sign in…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
      <h1 className="mb-3 text-4xl font-extrabold">Something went wrong</h1>
      <p className="mb-6 text-muted-foreground">
        Your account could not be loaded. Try again.
      </p>
      <Button type="button" variant="outline" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}