"use client";

import { Component, type ReactNode } from "react";

import { recoverFromAuthError } from "@/lib/auth-recovery";
import { toUiError } from "@/lib/errors";

/**
 * Catches AUTH_REQUIRED thrown by a live query and recovers the session
 * instead of letting it reach the root error page. Any other error is
 * rethrown so the nearest route boundary still handles it.
 */
export class AuthErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { error: unknown }
> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    if (toUiError(error).code === "AUTH_REQUIRED") {
      recoverFromAuthError(window.location.pathname);
    }
  }

  render() {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    if (toUiError(error).code !== "AUTH_REQUIRED") {
      throw error;
    }
    return this.props.fallback ?? null;
  }
}
