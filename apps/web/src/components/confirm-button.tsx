"use client";

import { Button } from "@saycheese/ui/components/button";
import { useEffect, useId, useRef, useState } from "react";

import { CONFIRM_COPY } from "@/lib/copy";

/**
 * A destructive-ish action behind an inline confirmation step. Deliberately
 * not `window.confirm`: the question stays in the page, is reachable by screen
 * readers and does not block the event loop.
 *
 * Opening the question moves focus to Confirm, because the trigger unmounts
 * and the browser would otherwise drop focus to `body`; cancelling returns it
 * to the trigger. A keyboard user is never sent back to the top of the page.
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const blocked = disabled || pending;

  useEffect(() => {
    if (confirming) {
      returnFocus.current = true;
      confirmRef.current?.focus();
      return;
    }
    if (returnFocus.current) {
      returnFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [confirming]);

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
          <p id={questionId} className="text-sm text-muted-foreground">
            {disabledReason}
          </p>
        )}
      </div>
    );
  }

  if (!confirming) {
    return (
      <Button
        ref={triggerRef}
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
    <div className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
      <p id={questionId} className="text-sm font-medium">
        {question}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          ref={confirmRef}
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
