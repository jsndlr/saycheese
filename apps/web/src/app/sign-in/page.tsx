import { safeNextPath } from "@saycheese/core/validation";
import type { Route } from "next";
import { redirect } from "next/navigation";

import SignInForm from "@/components/sign-in-form";
import { isAuthenticated } from "@/lib/auth-server";

type SignInSearchParams = Promise<{ next?: string | string[] }>;

export default async function SignInPage({ searchParams }: { searchParams: SignInSearchParams }) {
  const { next } = await searchParams;
  const nextPath = safeNextPath(Array.isArray(next) ? next[0] : next);

  // A signed-in visitor who followed a deep link goes where it pointed.
  if (await isAuthenticated()) {
    redirect(nextPath as Route);
  }

  return <SignInForm nextPath={nextPath} />;
}