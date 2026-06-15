"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { openEnterExamWindow } from "./enter-exam";
import {
  loadCandidateDashboard,
  scheduleCandidateExam,
  shouldShowNoPublishedExams,
  shouldShowPublishedExamList,
  type CandidateDashboardData,
} from "./candidate-scheduling";
import {
  buildScheduledAttemptViews,
  canEnterAttempt,
  getAttemptWaitingMessage,
  getLatestAttemptForExam,
} from "./candidate-home-state";

interface CandidateHomeProps {
  readonly email: string;
}

export function CandidateHome({ email }: CandidateHomeProps) {
  const router = useRouter();
  const [dashboard, setDashboard] = useState<CandidateDashboardData>({
    exams: [],
    attempts: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submittingExamId, setSubmittingExamId] = useState<string | null>(null);
  const [scheduleDrafts, setScheduleDrafts] = useState<Record<string, string>>({});
  const [coldStartNotice, setColdStartNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      setLoading(true);
      setError(null);
      try {
        if (!cancelled) {
          setDashboard(await loadCandidateDashboard(fetch));
        }
      } catch {
        if (!cancelled) {
          setError("Failed to load candidate dashboard");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  async function submitSchedule(examId: string) {
    const scheduledFor = scheduleDrafts[examId]?.trim();
    if (!scheduledFor) {
      setError("Choose a future date and time before scheduling.");
      return;
    }

    setSubmittingExamId(examId);
    setError(null);
    setColdStartNotice(null);
    try {
      const result = await scheduleCandidateExam(fetch, {
        examId,
        scheduledFor: new Date(scheduledFor).toISOString(),
      });
      setDashboard((current) => ({
        ...current,
        attempts: [
          current.attempts.filter((attempt) => attempt.id !== result.attempt.id),
          result.attempt,
        ].flat(),
      }));
      if (result.coldStartLikely) {
        setColdStartNotice(
          "Scheduled within five hours: CloudShare may cold-start the environment on login.",
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to schedule exam");
    } finally {
      setSubmittingExamId(null);
    }
  }

  function attemptForExam(examId: string) {
    return getLatestAttemptForExam(dashboard.attempts, examId);
  }

  function enterAttempt(attemptId: string) {
    setError(null);
    try {
      openEnterExamWindow(attemptId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to open exam window");
    }
  }

  const nowMs = Date.now();
  const scheduledAttempts = buildScheduledAttemptViews(dashboard, nowMs);

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
          Browse the published Helios CX Exams available to your account and schedule your next attempt.
        </div>

        {loading && <p style={{ margin: 0 }}>Loading candidate dashboard...</p>}
        {error && <p style={{ margin: 0, color: "#b00020" }}>{error}</p>}
        {coldStartNotice && <p style={{ margin: 0, color: "#7a4b00" }}>{coldStartNotice}</p>}
        {scheduledAttempts.length > 0 && (
          <section style={{ border: "1px solid #ddd", borderRadius: "8px", padding: "1rem", background: "#fafafa" }}>
            <h2 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "1.05rem" }}>Scheduled Exams</h2>
            <div style={{ display: "grid", gap: "0.75rem" }}>
              {scheduledAttempts.map((attempt) => (
                <article
                  key={attempt.attemptId}
                  style={{ border: "1px solid #e3e3e3", borderRadius: "6px", padding: "0.85rem", background: "#fff" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "baseline" }}>
                    <strong>{attempt.examTitle}</strong>
                    <span style={{ color: "#555" }}>Attempt ID: {attempt.attemptId}</span>
                  </div>
                  <p style={{ margin: "0.45rem 0", color: "#333" }}>
                    Scheduled for {attempt.scheduledFor ? new Date(attempt.scheduledFor).toLocaleString() : "TBD"}
                  </p>
                  <p style={{ margin: "0.45rem 0", color: "#0b5d3b" }}>Status: {attempt.status}</p>
                  {attempt.status === "ready" && (
                    <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
                      <button
                        onClick={() => enterAttempt(attempt.attemptId)}
                        disabled={!attempt.canEnter}
                        style={{ padding: "0.55rem 0.9rem" }}
                      >
                        Enter exam
                      </button>
                      {attempt.waitingMessage && (
                        <span style={{ color: "#555" }}>{attempt.waitingMessage}</span>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}
        {!error && shouldShowNoPublishedExams({ loading, examCount: dashboard.exams.length }) && (
          <p style={{ margin: 0 }}>No published Exams are available yet.</p>
        )}

        {shouldShowPublishedExamList({ loading, examCount: dashboard.exams.length }) && (
          <div style={{ display: "grid", gap: "0.9rem" }}>
            {dashboard.exams.map((exam) => {
              const attempt = attemptForExam(exam.id);
              return (
              <article key={exam.id} style={{ border: "1px solid #ddd", borderRadius: "8px", padding: "1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "baseline", flexWrap: "wrap" }}>
                  <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{exam.title}</h2>
                  <span style={{ color: "#555", fontSize: "0.95rem" }}>{exam.timeLimitMinutes} minute limit</span>
                </div>
                <p style={{ color: "#444" }}>{exam.description || "No description provided."}</p>
                {attempt && (
                  <p style={{ marginTop: 0, color: "#0b5d3b" }}>
                    Current attempt: {attempt.status}
                    {attempt.scheduledFor ? ` for ${new Date(attempt.scheduledFor).toLocaleString()}` : ""}
                  </p>
                )}
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                  <input
                    type="datetime-local"
                    value={scheduleDrafts[exam.id] ?? ""}
                    onChange={(event) =>
                      setScheduleDrafts((current) => ({
                        ...current,
                        [exam.id]: event.target.value,
                      }))
                    }
                  />
                  <button
                    onClick={() => void submitSchedule(exam.id)}
                    disabled={submittingExamId === exam.id}
                    style={{ padding: "0.55rem 0.9rem" }}
                  >
                    {submittingExamId === exam.id ? "Scheduling..." : "Schedule exam"}
                  </button>
                  {attempt?.status === "ready" && (
                    <button
                      onClick={() => enterAttempt(attempt.id)}
                      disabled={!canEnterAttempt(attempt, nowMs)}
                      style={{ padding: "0.55rem 0.9rem" }}
                    >
                      Enter exam
                    </button>
                  )}
                </div>
                {attempt?.status === "ready" && getAttemptWaitingMessage(attempt, nowMs) && (
                  <p style={{ marginBottom: 0, color: "#555" }}>
                    {getAttemptWaitingMessage(attempt, nowMs)}
                  </p>
                )}
              </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
