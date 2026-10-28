type FieldSchema = {
  safeParse: (value: unknown) => {
    success: boolean;
    error?: { issues: readonly { message: string }[] };
  };
};

type ErroredField = {
  state: { meta: { errorMap: Record<string, unknown> } };
  setErrorMap: (errorMap: { onBlur?: undefined; onSubmit?: undefined }) => void;
};

/**
 * TanStack Form keys errors by trigger (`errorMap.onBlur`, `errorMap.onSubmit`,
 * ...), so returning undefined from an `onChange` validator clears only that
 * key. This helper re-runs the field schema while a field shows an error and
 * clears the blur/submit slots; the validator's return value updates the
 * onChange slot. Fields without a shown error are left untouched, so errors
 * still first appear on blur or submit.
 */
export function revalidateShownError(
  field: ErroredField,
  schema: FieldSchema,
  value: string,
): string | undefined {
  const shown = Object.values(field.state.meta.errorMap).some(
    (error) => error !== undefined && error !== null,
  );
  if (!shown) {
    return undefined;
  }

  field.setErrorMap({ onBlur: undefined, onSubmit: undefined });

  const result = schema.safeParse(value);
  return result.success ? undefined : result.error?.issues[0]?.message;
}