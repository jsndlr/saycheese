import { safeNextPath } from "@saycheese/core/validation";
import { redirect } from "next/navigation";

import SignInForm from "@/components/sign-in-form";
import { isAuthenticated } from "@/lib/auth-server";

type SignInSearchParams = Promise<{ next?: string | string[] }>;

export default async function SignInPage({ searchParams }: { searchParams: SignInSearchParams }) {
  if (await isAuthenticated()) {
    redirect("/app");
  }

  const { next } = await searchParams;
  return <SignInForm nextPath={safeNextPath(Array.isArray(next) ? next[0] : next)} />;
}