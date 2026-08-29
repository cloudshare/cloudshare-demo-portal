"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { accountLogoutButtonStyle, disabledButtonStyle } from "./button-styles";
import { cardStyle } from "./card-styles";
import { colors, pageHeadingStyle, spacing } from "./design-tokens";

interface SalesTrialHomeProps {
  readonly email: string;
  readonly firstName?: string | null;
}

export function SalesTrialHome({ email, firstName }: SalesTrialHomeProps) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  async function signOut(): Promise<void> {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(null);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error(`Logout failed (${response.status})`);
      router.replace("/sales-trial/login");
      router.refresh();
    } catch {
      setLogoutError("Sign out failed. Try again.");
      setLoggingOut(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: spacing.xl,
        background: colors.surfaceMuted,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <section style={{ ...cardStyle, width: "100%", maxWidth: "640px" }}>
        <p style={{ marginTop: 0, color: colors.textSecondary }}>Certalis Sales Trial</p>
        <h1 style={{ ...pageHeadingStyle, marginTop: 0 }}>
          {firstName ? `Welcome, ${firstName}.` : "Welcome."}
        </h1>
        <p style={{ color: colors.textSecondary }}>
          Your Sales Trial sign-in is active for <strong>{email}</strong>.
        </p>
        <p style={{ color: colors.textSecondary, marginBottom: 0 }}>
          There are no active Trial Offerings right now. Sales Admins can publish offerings in a later slice; this page never falls back to Exams or Sales Admin content.
        </p>
        <button
          type="button"
          onClick={() => void signOut()}
          disabled={loggingOut}
          style={loggingOut ? { ...accountLogoutButtonStyle, ...disabledButtonStyle, marginTop: spacing.lg } : { ...accountLogoutButtonStyle, marginTop: spacing.lg }}
        >
          {loggingOut ? "Signing out..." : "Sign out"}
        </button>
        {logoutError ? <p role="status" style={{ color: colors.danger, marginBottom: 0 }}>{logoutError}</p> : null}
      </section>
    </main>
  );
}
