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

type TrialOffering = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly start: string;
  readonly end: string;
  readonly timeZone: string;
};

export function SalesTrialHome({ email, firstName }: SalesTrialHomeProps) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [offerings, setOfferings] = useState<TrialOffering[]>([]);
  const [offeringError, setOfferingError] = useState<string | null>(null);

  React.useEffect(() => {
    void fetch("/api/sales-trial/offerings")
      .then(async (response) => {
        const body = (await response.json()) as { offerings?: TrialOffering[]; error?: string };
        if (!response.ok) {
          throw new Error(body.error ?? "Could not load Trial Offerings.");
        }
        setOfferings(body.offerings ?? []);
      })
      .catch((error) => {
        setOfferingError(error instanceof Error ? error.message : "Could not load Trial Offerings.");
        setOfferings([]);
      });
  }, []);

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
        {offerings.length === 0 ? <p style={{ color: colors.textSecondary, marginBottom: 0 }}>
          There are no active Trial Offerings right now.
        </p> : <div style={{ display: "grid", gap: spacing.md }}>
          {offerings.map((offering) => <article key={offering.id} style={{ border: "1px solid #d8dee8", borderRadius: "10px", padding: spacing.md, background: "#ffffff" }}>
            <h2 style={{ marginTop: 0 }}>{offering.title}</h2>
            <p style={{ color: colors.textSecondary }}>{offering.description}</p>
            <p style={{ color: colors.textSecondary, marginBottom: 0 }}>{offering.start} to {offering.end} ({offering.timeZone})</p>
          </article>)}
        </div>}
        {offeringError ? <p role="status" style={{ color: colors.danger, marginBottom: 0 }}>{offeringError}</p> : null}
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
