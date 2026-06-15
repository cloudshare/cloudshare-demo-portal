"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface CandidateHomeProps {
  readonly email: string;
}

interface CandidateExamRecord {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly timeLimitMinutes: number;
  readonly status: "draft" | "published";
}

export function CandidateHome({ email }: CandidateHomeProps) {
  const router = useRouter();
  const [exams, setExams] = useState<CandidateExamRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadExams() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/candidate/exams");
        const data = (await response.json()) as {
          exams?: CandidateExamRecord[];
          error?: string;
        };
        if (!response.ok) {
          if (!cancelled) {
            setError(data.error ?? "Failed to load published Exams");
          }
          return;
        }
        if (!cancelled) {
          setExams(data.exams ?? []);
        }
      } catch {
        if (!cancelled) {
          setError("Failed to load published Exams");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadExams();
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "900px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.35rem" }}>Candidate Home</h1>
          <p style={{ margin: 0, color: "#555" }}>Signed in as {email}</p>
        </div>
        <button onClick={() => void logout()} style={{ padding: "0.55rem 0.9rem" }}>
          Log out
        </button>
      </div>

      <section style={{ display: "grid", gap: "1rem" }}>
        <div style={{ padding: "1rem", background: "#f7f7f8", borderRadius: "6px" }}>
          Browse the published Helios CX Exams available to your account. Scheduling and launch arrive in later slices.
        </div>

        {loading && <p style={{ margin: 0 }}>Loading published Exams...</p>}
        {error && <p style={{ margin: 0, color: "#b00020" }}>{error}</p>}
        {!loading && !error && exams.length === 0 && (
          <p style={{ margin: 0 }}>No published Exams are available yet.</p>
        )}

        {!loading && !error && exams.length > 0 && (
          <div style={{ display: "grid", gap: "0.9rem" }}>
            {exams.map((exam) => (
              <article key={exam.id} style={{ border: "1px solid #ddd", borderRadius: "8px", padding: "1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "baseline", flexWrap: "wrap" }}>
                  <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{exam.title}</h2>
                  <span style={{ color: "#555", fontSize: "0.95rem" }}>{exam.timeLimitMinutes} minute limit</span>
                </div>
                <p style={{ marginBottom: 0, color: "#444" }}>{exam.description || "No description provided."}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
