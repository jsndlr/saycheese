import { redirect } from "next/navigation";

import SignUpForm from "@/components/sign-up-form";
import { isAuthenticated } from "@/lib/auth-server";

export default async function SignUpPage() {
  if (await isAuthenticated()) {
    redirect("/app");
  }

  return <SignUpForm />;
}