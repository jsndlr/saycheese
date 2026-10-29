"use client";

import { ERROR_MESSAGES } from "@saycheese/core/errors";
import { signUpSchema } from "@saycheese/core/validation";
import { Button } from "@saycheese/ui/components/button";
import { useForm } from "@tanstack/react-form";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { FormField } from "@/components/form-field";
import { authClient } from "@/lib/auth-client";
import { parseSignUpInput } from "@/lib/auth-input";
import { toUiError } from "@/lib/errors";
import { firstFieldError } from "@/lib/form-error";
import { revalidateShownError } from "@/lib/form-validation";

export default function SignUpForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      name: "",
      email: "",
      password: "",
    },
    // See sign-in-form: the button is disabled only while submitting.
    canSubmitWhenInvalid: true,
    onSubmit: async ({ value }) => {
      setServerError(null);

      const parsed = parseSignUpInput(value);
      if (!parsed.success) {
        setServerError(ERROR_MESSAGES.VALIDATION_FAILED);
        return;
      }

      try {
        const { error } = await authClient.signUp.email({
          email: parsed.data.email,
          password: parsed.data.password,
          name: parsed.data.name,
        });

        if (error) {
          setServerError(toUiError(error).message);
          return;
        }
      } catch (error) {
        setServerError(toUiError(error).message);
        return;
      }

      toast.success("Account created");
      router.push("/app");
      router.refresh();
    },
  });

  return (
    <div className="curtain flex flex-1 items-center justify-center px-4 py-12 sm:py-16">
    <div className="rise w-full max-w-md rounded-3xl bg-card p-7 text-card-foreground shadow-strip sm:p-10">
      <h1 className="mb-8 text-4xl font-extrabold">Create account</h1>

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
          name="name"
          validators={{
            onBlur: signUpSchema.shape.name,
            onSubmit: signUpSchema.shape.name,
            onChange: ({ value, fieldApi }) =>
              revalidateShownError(fieldApi, signUpSchema.shape.name, value),
          }}
        >
          {(field) => (
            <FormField
              name={field.name}
              label="Name"
              autoComplete="name"
              value={field.state.value}
              error={firstFieldError(field.state.meta.errors)}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
            />
          )}
        </form.Field>

        <form.Field
          name="email"
          validators={{
            onBlur: signUpSchema.shape.email,
            onSubmit: signUpSchema.shape.email,
            onChange: ({ value, fieldApi }) =>
              revalidateShownError(fieldApi, signUpSchema.shape.email, value),
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
            onBlur: signUpSchema.shape.password,
            onSubmit: signUpSchema.shape.password,
            onChange: ({ value, fieldApi }) =>
              revalidateShownError(fieldApi, signUpSchema.shape.password, value),
          }}
        >
          {(field) => (
            <FormField
              name={field.name}
              label="Password"
              type="password"
              autoComplete="new-password"
              value={field.state.value}
              error={firstFieldError(field.state.meta.errors)}
              hint="At least 12 characters."
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
              {isSubmitting ? "Creating account..." : "Sign up"}
            </Button>
          )}
        </form.Subscribe>
      </form>

      <div className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-semibold text-primary-text underline-offset-4 hover:underline">
          Sign in
        </Link>
      </div>
      </div>
    </div>
  );
}