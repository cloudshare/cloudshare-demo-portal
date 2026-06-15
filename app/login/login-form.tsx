"use client";

import { useState } from "react";

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
        session?: { role?: "admin" | "candidate" };
      };
      if (!response.ok) {
        setError(data.error ?? "Login failed");
        return;
      }

      window.location.assign(data.session?.role === "admin" ? "/admin" : "/candidate");
    } catch {
      setError("Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "420px", margin: "0 auto" }}>
      <h1>Certalis Portal Login</h1>
      <p style={{ color: "#555", marginBottom: "1.5rem" }}>
        Sign in as a Helios admin or Candidate.
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
            style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }}
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
            style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }}
          />
        </label>
        <button disabled={loading} type="submit" style={{ padding: "0.8rem 1rem" }}>
          {loading ? "Signing in..." : "Sign in"}
        </button>
        {error && <p style={{ color: "#b00020", margin: 0 }}>{error}</p>}
      </form>
      <p style={{ color: "#555", marginTop: "1rem" }}>
        New Candidate? <a href="/register">Create your account</a>.
      </p>
    </main>
  );
}
