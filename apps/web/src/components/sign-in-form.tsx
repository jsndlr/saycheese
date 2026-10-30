"use client";

import { ERROR_MESSAGES } from "@saycheese/core/errors";
import { signInSchema } from "@saycheese/core/validation";
import { Button } from "@saycheese/ui/components/button";
import { useForm } from "@tanstack/react-form";
import Link from "next/link";
import { useState } from "react";

import { FormField } from "@/components/form-field";
import { authClient } from "@/lib/auth-client";
import { signUpPath } from "@/lib/auth-path";
import { parseSignInInput } from "@/lib/auth-input";
import { toUiError } from "@/lib/errors";
import { firstFieldError } from "@/lib/form-error";
import { revalidateShownError } from "@/lib/form-validation";

export default function SignInForm({ nextPath }: { nextPath: string }) {
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
    },
    // Keep submit reachable after a failed attempt: the button is disabled only
    // while submitting, and each submit re-runs field validation.
    canSubmitWhenInvalid: true,
    onSubmit: async ({ value }) => {
      setServerError(null);

      const parsed = parseSignInInput(value);
      if (!parsed.success) {
        setServerError(ERROR_MESSAGES.VALIDATION_FAILED);
        return;
      }

      try {
        const { error } = await authClient.signIn.email({
          email: parsed.data.email,
          password: parsed.data.password,
        });

        if (error) {
          setServerError(toUiError(error).message);
          return;
        }
      } catch (error) {
        setServerError(toUiError(error).message);
        return;
      }

      // A full load, not a client push: the root layout and the Convex client
      // must start from the new session's token. A soft navigation can keep the
      // previous session's token, and every query then fails AUTH_REQUIRED.
      // safeNextPath has already restricted this to a same-origin relative path.
      window.location.assign(nextPath);
    },
  });

  return (
    <div className="curtain flex flex-1 items-start justify-center px-4 py-6 sm:items-center sm:py-16">
    <div className="rise w-full max-w-md rounded-3xl bg-card p-6 text-card-foreground shadow-strip sm:p-10">
      <h1 className="mb-6 text-3xl font-extrabold sm:mb-8 sm:text-4xl">Welcome back</h1>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          form.handleSubmit();
        }}
        className="space-y-2"
        noValidate
      >
        <form.Field
          name="email"
          validators={{
            onBlur: signInSchema.shape.email,
            onSubmit: signInSchema.shape.email,
            onChange: ({ value, fieldApi }) =>
              revalidateShownError(fieldApi, signInSchema.shape.email, value),
          }}
        >
          {(field) => (
            <FormField
              name={field.name}
              label="Email"
              type="email"
              autoComplete="email"
              value={field.state.value}
              error={firstFieldError(field.state.meta.errors)}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
            />
          )}
        </form.Field>

        <form.Field
          name="password"
          validators={{
            onBlur: signInSchema.shape.password,
            onSubmit: signInSchema.shape.password,
            onChange: ({ value, fieldApi }) =>
              revalidateShownError(fieldApi, signInSchema.shape.password, value),
          }}
        >
          {(field) => (
            <FormField
              name={field.name}
              label="Password"
              type="password"
              autoComplete="current-password"
              value={field.state.value}
              error={firstFieldError(field.state.meta.errors)}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
            />
          )}
        </form.Field>

        {serverError ? (
          <p role="alert" className="text-sm text-destructive">
            {serverError}
          </p>
        ) : null}

        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" size="lg" className="mt-2 w-full" disabled={isSubmitting}>
              {isSubmitting ? "Signing in..." : "Sign in"}
            </Button>
          )}
        </form.Subscribe>
      </form>

      <div className="mt-6 text-center text-sm text-muted-foreground">
        Need an account?{" "}
        <Link href={signUpPath(nextPath)} className="font-semibold text-primary-text underline-offset-4 hover:underline">
          Sign up
        </Link>
      </div>
      </div>
    </div>
  );
}