"use client";

import React from "react";
import { useState } from "react";

export function RegisterForm() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/candidate/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, password }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Registration failed");
        return;
      }

      window.location.assign("/login");
    } catch {
      setError("Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "420px", margin: "0 auto" }}>
      <h1>Candidate Registration</h1>
      <p style={{ color: "#555", marginBottom: "1.5rem" }}>
        Create your Helios CX Candidate account to browse published Exams.
      </p>
      <form
        onSubmit={onSubmit}
        action="/api/candidate/register"
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
            style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }}
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
            style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }}
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
            autoComplete="new-password"
            required
            style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }}
          />
        </label>
        <button disabled={loading} type="submit" style={{ padding: "0.8rem 1rem" }}>
          {loading ? "Creating account..." : "Create account"}
        </button>
        {error && <p style={{ color: "#b00020", margin: 0 }}>{error}</p>}
      </form>
      <p style={{ color: "#555", marginTop: "1rem" }}>
        Already registered? <a href="/login">Sign in</a>.
      </p>
    </main>
  );
}
