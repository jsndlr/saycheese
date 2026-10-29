"use client";

import { Button } from "@saycheese/ui/components/button";
import { useId, useState } from "react";

import { CONFIRM_COPY } from "@/lib/copy";

/**
 * A destructive-ish action behind an inline confirmation step. Deliberately
 * not `window.confirm`: the question stays in the page, is reachable by screen
 * readers and does not block the event loop.
 *
 * `disabled` also renders `disabledReason` (for example "Wait until scoring
 * finishes"), so a caller cannot show a dead button without explaining it.
 */
export function ConfirmButton({
  label,
  question,
  pendingLabel,
  variant = "outline",
  size = "sm",
  disabled = false,
  disabledReason,
  pending = false,
  onConfirm,
}: {
  label: string;
  question: string;
  pendingLabel?: string;
  variant?: "outline" | "destructive" | "secondary";
  size?: "xs" | "sm" | "default";
  disabled?: boolean;
  disabledReason?: string;
  pending?: boolean;
  onConfirm: () => void;
}) {
  const questionId = useId();
  const [confirming, setConfirming] = useState(false);
  const blocked = disabled || pending;

  if (blocked) {
    return (
      <div className="space-y-2">
        <Button
          type="button"
          variant={variant}
          size={size}
          disabled
          aria-describedby={disabledReason === undefined ? undefined : questionId}
        >
          {pending && pendingLabel !== undefined ? pendingLabel : label}
        </Button>
        {disabledReason === undefined ? null : (
          <p id={questionId} className="text-xs text-muted-foreground">
            {disabledReason}
          </p>
        )}
      </div>
    );
  }

  if (!confirming) {
    return (
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => setConfirming(true)}
      >
        {label}
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <p id={questionId} className="text-sm">
        {question}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={variant}
          size={size}
          aria-describedby={questionId}
          onClick={() => {
            // Collapse back to the plain action before the caller flips to its
            // pending state, so a second confirm cannot race the first call.
            setConfirming(false);
            onConfirm();
          }}
        >
          {CONFIRM_COPY.confirm}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size={size}
          onClick={() => setConfirming(false)}
        >
          {CONFIRM_COPY.cancel}
        </Button>
      </div>
    </div>
  );
}
