import { signInSchema, signUpSchema } from "@saycheese/core/validation";

/**
 * Parses raw form values into normalized values. TanStack Form's schema
 * validators only report issues, so the onSubmit handler must parse again to
 * obtain Zod's trims and lowercasing.
 */
export function parseSignUpInput(input: unknown) {
  return signUpSchema.safeParse(input);
}

export function parseSignInInput(input: unknown) {
  return signInSchema.safeParse(input);
}