import { safeNextPath } from "@saycheese/core/validation";
import type { Route } from "next";
import { redirect } from "next/navigation";

import SignUpForm from "@/components/sign-up-form";
import { isAuthenticated } from "@/lib/auth-server";

type SignUpSearchParams = Promise<{ next?: string | string[] }>;

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: SignUpSearchParams;
}) {
  const { next } = await searchParams;
  const nextPath = safeNextPath(Array.isArray(next) ? next[0] : next);

  if (await isAuthenticated()) {
    redirect(nextPath as Route);
  }

  return <SignUpForm nextPath={nextPath} />;
}
