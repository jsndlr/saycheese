import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;
export const NAME_MAX_LENGTH = 80;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: "Enter a valid email address." }));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`);

export const nameSchema = z
  .string()
  .trim()
  .min(1, "Enter your name.")
  .max(NAME_MAX_LENGTH, `Name must be at most ${NAME_MAX_LENGTH} characters.`);

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: nameSchema,
});

/**
 * Sign-in deliberately does not apply the password policy: an existing account
 * with a shorter password must reach Better Auth so it fails as
 * INVALID_CREDENTIALS instead of leaking a policy hint.
 */
export const signInSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(1, "Enter your password.")
    .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;

const FALLBACK_PATH = "/app";
const MAX_DECODE_PASSES = 5;

function decodeFully(value: string): string | null {
  let current = value;
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return null;
    }
    if (decoded === current) {
      return current;
    }
    current = decoded;
  }
  return current;
}

/**
 * Accepts only same-origin relative paths. Anything else (absolute URLs,
 * protocol-relative paths, backslash tricks, encoded variants) collapses to
 * `/app`.
 */
export function safeNextPath(input: unknown): string {
  if (typeof input !== "string" || input.length === 0) {
    return FALLBACK_PATH;
  }

  const decoded = decodeFully(input);
  if (decoded === null) {
    return FALLBACK_PATH;
  }

  if (!decoded.startsWith("/") || decoded.startsWith("//")) {
    return FALLBACK_PATH;
  }
  if (decoded.includes("\\")) {
    return FALLBACK_PATH;
  }
  if (/[\u0000-\u001f\u007f]/.test(decoded)) {
    return FALLBACK_PATH;
  }

  return input;
}
