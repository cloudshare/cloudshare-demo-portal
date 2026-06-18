"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LabLauncher } from "./lab-launcher";
import { getCandidateLabPresentation } from "./candidate-lab-state";

type AttemptStatus = "ready" | "in_progress" | "suspended" | "completed";
type CandidateLabStatus = {
  examAttemptId: string;
  examTitle: string;
  timeLimitMinutes: number;
  status: AttemptStatus;
  scheduledFor: string | null;
};

export function CandidateLabShell({
  examAttemptId,
  initialAttemptStatus,
}: {
  readonly examAttemptId: string;
  readonly initialAttemptStatus: AttemptStatus;
}) {
  const router = useRouter();
  const [labStatus, setLabStatus] = useState<CandidateLabStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      const response = await fetch(
        `/api/exam/status?examAttemptId=${encodeURIComponent(examAttemptId)}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        return;
      }

      const json = (await response.json()) as CandidateLabStatus;
      if (!cancelled) {
        setLabStatus(json);
      }
    }

    void loadStatus().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [examAttemptId]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const presentation = getCandidateLabPresentation({
    status: labStatus?.status ?? initialAttemptStatus,
    examAttemptId,
    examTitle: labStatus?.examTitle ?? "Launch lab",
    timeLimitMinutes: labStatus?.timeLimitMinutes ?? 0,
  });

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "720px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.35rem" }}>{presentation.heading}</h1>
          <p style={{ margin: 0, color: "#555" }}>{presentation.supportDetail}</p>
          <p style={{ margin: "0.35rem 0 0", color: "#0b5d3b" }}>
            Status: {presentation.statusLabel}
          </p>
          {labStatus?.timeLimitMinutes ? (
            <p style={{ margin: "0.35rem 0 0", color: "#555" }}>{presentation.timeLimitLabel}</p>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button type="button" onClick={() => router.push("/candidate")} style={{ padding: "0.55rem 0.9rem" }}>
            Back to Candidate Home
          </button>
          {presentation.showScoreLink ? (
            <button
              type="button"
              onClick={() => router.push(`/candidate/score?examAttemptId=${encodeURIComponent(examAttemptId)}`)}
              style={{ padding: "0.55rem 0.9rem" }}
            >
              View score
            </button>
          ) : null}
          <button type="button" onClick={() => void logout()} style={{ padding: "0.55rem 0.9rem" }}>
            Log out
          </button>
        </div>
      </div>
      {presentation.notice ? (
        <p style={{ marginTop: 0, marginBottom: "1rem", color: "#0b5d3b" }}>{presentation.notice}</p>
      ) : null}
      <LabLauncher
        examAttemptId={examAttemptId}
        currentAttemptStatus={labStatus?.status ?? initialAttemptStatus}
        onAttemptStatusChange={(status) =>
          setLabStatus((current) =>
            current
              ? {
                  ...current,
                  status,
                }
              : current,
          )
        }
      />
    </main>
  );
}
