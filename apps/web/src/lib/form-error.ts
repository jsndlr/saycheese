/**
 * TanStack Form surfaces validation errors as Standard Schema issues, plain
 * strings or undefined. Forms only render the first one.
 */
export function firstFieldError(errors: readonly unknown[]): string | undefined {
  for (const error of errors) {
    if (typeof error === "string") {
      return error;
    }
    if (error !== null && typeof error === "object" && "message" in error) {
      const message = error.message;
      if (typeof message === "string" && message.length > 0) {
        return message;
      }
    }
  }
  return undefined;
}