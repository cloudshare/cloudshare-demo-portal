"use client";

import React from "react";
import { useState } from "react";
import { primaryButtonStyle } from "@/web/button-styles";
import { cardStyle } from "@/web/card-styles";
import { colors, pageHeadingStyle, spacing } from "@/web/design-tokens";

interface SalesTrialRegisterFormProps {
  readonly initialError?: string | null;
}

export function SalesTrialRegisterForm({ initialError = null }: SalesTrialRegisterFormProps = {}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/sales-trial/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, password }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Registration failed");
        return;
      }

      window.location.assign("/sales-trial/login");
    } catch {
      setError("Registration failed");
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
          Sales Trial Registration
        </h1>
        <p style={{ color: colors.textSecondary, marginBottom: spacing.lg }}>
          Register with your email to create a Sales Trial participant account.
        </p>
        <form
          onSubmit={onSubmit}
          action="/api/sales-trial/register"
          method="post"
          style={{ display: "grid", gap: "1rem" }}
        >
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>First name</span>
            <input
              name="firstName"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              autoComplete="given-name"
              minLength={2}
              required
              style={{ padding: "0.7rem", border: `1px solid ${colors.borderStrong}`, borderRadius: "6px" }}
            />
          </label>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Last name</span>
            <input
              name="lastName"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              autoComplete="family-name"
              minLength={2}
              required
              style={{ padding: "0.7rem", border: `1px solid ${colors.borderStrong}`, borderRadius: "6px" }}
            />
          </label>
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
              autoComplete="new-password"
              required
              style={{ padding: "0.7rem", border: `1px solid ${colors.borderStrong}`, borderRadius: "6px" }}
            />
          </label>
          <button disabled={loading} type="submit" style={primaryButtonStyle}>
            {loading ? "Creating account..." : "Create account"}
          </button>
          {error && <p style={{ color: colors.danger, margin: 0 }}>{error}</p>}
        </form>
        <p style={{ color: colors.textSecondary, marginTop: "1rem" }}>
          Already registered? <a href="/sales-trial/login">Sign in</a>.
        </p>
      </div>
    </main>
  );
}
