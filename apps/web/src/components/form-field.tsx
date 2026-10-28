"use client";

import { Input } from "@saycheese/ui/components/input";
import { Label } from "@saycheese/ui/components/label";

export function FormField({
  name,
  label,
  type = "text",
  autoComplete,
  value,
  error,
  hint,
  onBlur,
  onChange,
}: {
  name: string;
  label: string;
  type?: "text" | "email" | "password";
  autoComplete: string;
  value: string;
  error: string | undefined;
  hint?: string;
  onBlur: () => void;
  onChange: (value: string) => void;
}) {
  const errorId = `${name}-error`;

  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error !== undefined}
        aria-describedby={errorId}
      />
      {/* Reserved height: an error appearing or clearing must not move the button. */}
      <p id={errorId} className="min-h-5 text-sm text-destructive">
        {error ?? ""}
      </p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}