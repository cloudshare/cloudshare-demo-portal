"use client";

import { useState } from "react";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

export interface CandidateLogoutPresentation {
  readonly buttonLabel: string;
  readonly disabled: boolean;
  readonly statusMessage: string | null;
  readonly errorMessage: string | null;
}

export function getCandidateLogoutPresentation(input: {
  readonly pending: boolean;
  readonly error: string | null;
}): CandidateLogoutPresentation {
  if (input.pending) {
    return {
      buttonLabel: "Logging out...",
      disabled: true,
      statusMessage: "Suspending any running lab before logging out...",
      errorMessage: null,
    };
  }

  if (input.error) {
    return {
      buttonLabel: "Try log out again",
      disabled: false,
      statusMessage: null,
      errorMessage: input.error,
    };
  }

  return {
    buttonLabel: "Log out",
    disabled: false,
    statusMessage: null,
    errorMessage: null,
  };
}

export function useCandidateLogout(router: AppRouterInstance): {
  readonly presentation: CandidateLogoutPresentation;
  readonly logout: () => Promise<void>;
} {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout(): Promise<void> {
    if (pending) {
      return;
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        throw new Error(`Logout failed (${response.status})`);
      }
      router.push("/login");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Logout failed.");
      setPending(false);
    }
  }

  return {
    presentation: getCandidateLogoutPresentation({ pending, error }),
    logout,
  };
}
