"use client";

import { Button } from "@saycheese/ui/components/button";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

function isAuthRequired(error: Error): boolean {
  if (error.message.includes("AUTH_REQUIRED")) {
    return true;
  }
  if (!("data" in error)) {
    return false;
  }
  const { data } = error;
  return (
    typeof data === "object" &&
    data !== null &&
    "code" in data &&
    data.code === "AUTH_REQUIRED"
  );
}

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const authRequired = isAuthRequired(error);

  useEffect(() => {
    if (authRequired) {
      router.replace("/sign-in?next=/app");
    }
  }, [authRequired, router]);

  if (authRequired) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-8">
        <p className="text-sm text-muted-foreground">Redirecting to sign in…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-semibold">Something went wrong</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Your account could not be loaded. Try again.
      </p>
      <Button type="button" variant="outline" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}