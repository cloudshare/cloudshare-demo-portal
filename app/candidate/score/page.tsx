import React from "react";
import { ScoreDisplay } from "@/web/score-display";
import { pageShellStyle } from "@/web/page-shell";

/**
 * Candidate score page. Shown after the lab session completes.
 * Renders the Guided Journey ScoreResult for the exam attempt, including
 * CloudShare's known scoring limitations surfaced inline.
 */
export default async function CandidateScorePage({
  searchParams,
}: {
  searchParams: Promise<{ examAttemptId?: string }>;
}) {
  const { examAttemptId } = await searchParams;

  if (!examAttemptId) {
    return (
      <main style={pageShellStyle}>
        <h1 style={{ marginBottom: "0.5rem" }}>Session complete</h1>
        <p style={{ color: "#555" }}>Missing examAttemptId.</p>
      </main>
    );
  }

  return (
    <main style={pageShellStyle}>
      <h1 style={{ marginBottom: "0.35rem" }}>Session complete</h1>
      <p style={{ margin: "0 0 1rem", color: "#475569" }}>
        Review your final Guided Journey result and any CloudShare scoring limitations for this ExamAttempt.
      </p>
      <ScoreDisplay examAttemptId={examAttemptId} />
    </main>
  );
}
