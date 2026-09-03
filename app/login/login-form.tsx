"use client";

import React, { useState } from "react";
import { cardStyle } from "@/web/card-styles";
import { primaryButtonStyle, secondaryButtonStyle } from "@/web/button-styles";
import { colors, pageHeadingStyle, spacing } from "@/web/design-tokens";

interface LoginFormProps {
  readonly initialError: string | null;
  readonly initialEmail: string;
  readonly returnTo?: string | null;
}

export function LoginForm({ initialError, initialEmail, returnTo = null }: LoginFormProps) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/auth/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = (await response.json()) as {
        error?: string;
        session?: {
          role?: "admin" | "candidate" | "sales_trial_participant";
          workspace?: "certification" | "sales" | "both";
        };
        redirectTo?: string;
      };
      if (!response.ok) {
        setError(data.error ?? "Login failed");
        return;
      }

      window.location.assign(data.redirectTo ?? (
        data.session?.role === "admin"
          ? data.session.workspace === "sales"
            ? "/sales"
            : "/admin"
          : data.session?.role === "sales_trial_participant"
            ? "/sales-trial"
            : "/candidate"
      ));
    } catch {
      setError("Login failed");
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
        <h1 style={{ ...pageHeadingStyle, fontSize: "1.6rem", marginTop: 0 }}>Certalis Portal Login</h1>
        <p style={{ color: colors.textSecondary, marginBottom: spacing.lg }}>
          Sign in to your existing Certification, Sales, or Sales Trial account.
        </p>
        <form
          onSubmit={onSubmit}
          action={returnTo ? `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}` : "/api/auth/login"}
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
        <section
          aria-labelledby="registration-options-heading"
          style={{
            borderTop: `1px solid ${colors.border}`,
            marginTop: spacing.lg,
            paddingTop: spacing.lg,
          }}
        >
          <h2
            id="registration-options-heading"
            style={{ ...pageHeadingStyle, fontSize: "1.1rem", margin: 0 }}
          >
            New here? Choose a demo
          </h2>
          <p style={{ color: colors.textSecondary, margin: `${spacing.sm} 0 ${spacing.md}` }}>
            Create the account that matches what you want to explore.
          </p>
          <div style={{ display: "grid", gap: spacing.sm }}>
            <a
              href="/register"
              style={{ ...secondaryButtonStyle, boxSizing: "border-box", textDecoration: "none", width: "100%" }}
            >
              Certification demo
            </a>
            <a
              href="/sales-trial/register"
              style={{ ...secondaryButtonStyle, boxSizing: "border-box", textDecoration: "none", width: "100%" }}
            >
              Sales Trial demo
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
