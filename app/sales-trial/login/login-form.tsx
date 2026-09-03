"use client";

import React, { useState } from "react";
import { primaryButtonStyle } from "@/web/button-styles";
import { cardStyle } from "@/web/card-styles";
import { colors, pageHeadingStyle, spacing } from "@/web/design-tokens";

interface SalesTrialLoginFormProps {
  readonly initialError: string | null;
  readonly initialEmail: string;
  readonly returnTo?: string | null;
}

export function SalesTrialLoginForm({
  initialError,
  initialEmail,
  returnTo = null,
}: SalesTrialLoginFormProps) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/sales-trial/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await response.json()) as { error?: string; redirectTo?: string };
      if (!response.ok) {
        setError(data.error ?? "Sign in failed");
        return;
      }

      window.location.assign(data.redirectTo ?? "/sales-trial");
    } catch {
      setError("Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: spacing.xl,
        background: colors.surfaceMuted,
      }}
    >
      <div style={{ ...cardStyle, width: "100%", maxWidth: "420px" }}>
        <h1 style={{ ...pageHeadingStyle, fontSize: "1.6rem", marginTop: 0 }}>
          Sales Trial Sign In
        </h1>
        <p style={{ color: colors.textSecondary, marginBottom: spacing.lg }}>
          Sign in with the email and password you used for your Sales Trial registration.
        </p>
        <form
          onSubmit={onSubmit}
          action={returnTo ? `/api/sales-trial/login?returnTo=${encodeURIComponent(returnTo)}` : "/api/sales-trial/login"}
          method="post"
          style={{ display: "grid", gap: "1rem" }}
        >
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Email</span>
            <input
              name="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              style={{ padding: "0.7rem", border: `1px solid ${colors.borderStrong}`, borderRadius: "6px" }}
            />
          </label>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Password</span>
            <input
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              style={{ padding: "0.7rem", border: `1px solid ${colors.borderStrong}`, borderRadius: "6px" }}
            />
          </label>
          <button disabled={loading} type="submit" style={primaryButtonStyle}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
          {error && <p style={{ color: colors.danger, margin: 0 }}>{error}</p>}
        </form>
        <p style={{ color: colors.textSecondary, marginTop: "1rem" }}>
          Need an account? <a href="/sales-trial/register">Register for a Sales Trial</a>.
        </p>
      </div>
    </main>
  );
}
