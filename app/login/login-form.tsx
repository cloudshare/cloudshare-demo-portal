"use client";

import { useState } from "react";
import { cardStyle } from "@/web/card-styles";
import { primaryButtonStyle } from "@/web/button-styles";
import { colors, pageHeadingStyle, spacing } from "@/web/design-tokens";

interface LoginFormProps {
  readonly initialError: string | null;
  readonly initialEmail: string;
}

export function LoginForm({ initialError, initialEmail }: LoginFormProps) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = (await response.json()) as {
        error?: string;
        session?: { role?: "admin" | "candidate"; workspace?: "certification" | "sales" | "both" };
      };
      if (!response.ok) {
        setError(data.error ?? "Login failed");
        return;
      }

      window.location.assign(data.session?.role === "admin" ? data.session.workspace === "sales" ? "/sales" : "/admin" : "/candidate");
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
          Sign in as a Helios admin, Certalis Sales Admin, or Candidate.
        </p>
        <form
          onSubmit={onSubmit}
          action="/api/auth/login"
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
          New Candidate? <a href="/register">Create your account</a>.
        </p>
      </div>
    </main>
  );
}
