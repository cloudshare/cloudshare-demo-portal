"use client";

import React, { useEffect, useState } from "react";
import type { AdminAuthenticatedRequest } from "./admin-authenticated-request";
import { isAdminSessionExpiredError } from "./admin-authenticated-request";
import { alertPanelStyle, mutedPanelStyle } from "./card-styles";
import { primaryButtonStyle } from "./button-styles";
import {
  formatAdminAttemptStatus,
  formatAdminUtcTimestamp,
  type AdminAttemptStatus,
} from "./admin-attempt-presentation";

export interface AdminCandidateScoreEvidence {
  readonly scoreAvailable: boolean;
  readonly percentComplete?: number;
  readonly stepsCompleted?: number;
  readonly stepsTotal?: number;
  readonly passedRate?: number;
  readonly failedRate?: number;
  readonly retrievedAt: string;
}

export interface AdminCandidateAttemptSummary {
  readonly scheduled: number;
  readonly ready: number;
  readonly inProgress: number;
  readonly suspended: number;
  readonly completed: number;
  readonly expired: number;
  readonly total: number;
}

export interface AdminCandidateAttempt {
  readonly id: string;
  readonly examId: string;
  readonly examTitle: string;
  readonly status: AdminAttemptStatus;
  readonly scheduledFor: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly scoreRetrievalEnabled: boolean;
  readonly score: AdminCandidateScoreEvidence | null;
}

export interface AdminCandidateRosterItem {
  readonly id: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly name: string;
  readonly createdAt: string;
  readonly attemptSummary: AdminCandidateAttemptSummary;
  readonly latestAttempt: AdminCandidateAttempt | null;
  readonly latestScore: AdminCandidateScoreEvidence | null;
}

export interface AdminCandidateDetail extends AdminCandidateRosterItem {
  readonly attempts: AdminCandidateAttempt[];
}

interface CandidateErrorState {
  readonly message: string;
}

function formatCandidateScore(score: AdminCandidateScoreEvidence | null): string {
  if (!score) return "No score evidence";
  if (!score.scoreAvailable) return "No score available";

  if (typeof score.passedRate === "number" || typeof score.failedRate === "number") {
    const rates = [
      typeof score.passedRate === "number" ? `${Math.round(score.passedRate * 100)}% passed` : null,
      typeof score.failedRate === "number" ? `${Math.round(score.failedRate * 100)}% failed` : null,
    ].filter((value): value is string => value !== null);
    const steps = typeof score.stepsCompleted === "number" && typeof score.stepsTotal === "number"
      ? ` (${score.stepsCompleted}/${score.stepsTotal} steps)`
      : "";
    return `${rates.join(", ")}${steps}`;
  }

  const percent = typeof score.percentComplete === "number" ? `${score.percentComplete}%` : "Progress recorded";
  const steps = typeof score.stepsCompleted === "number" && typeof score.stepsTotal === "number"
    ? ` (${score.stepsCompleted}/${score.stepsTotal} steps)`
    : "";
  return `${percent}${steps}`;
}

function formatAttemptSummary(summary: AdminCandidateAttemptSummary): string {
  if (summary.total === 0) return "No attempts";
  return [
    `${summary.total} total`,
    summary.scheduled ? `${summary.scheduled} scheduled` : null,
    summary.ready ? `${summary.ready} ready` : null,
    summary.inProgress ? `${summary.inProgress} in progress` : null,
    summary.suspended ? `${summary.suspended} suspended` : null,
    summary.completed ? `${summary.completed} completed` : null,
    summary.expired ? `${summary.expired} expired` : null,
  ].filter((item): item is string => item !== null).join(" | ");
}

export function AdminCandidateRosterPanel(props: {
  readonly candidates: readonly AdminCandidateRosterItem[] | null;
  readonly selectedCandidate: AdminCandidateDetail | null;
  readonly loading: boolean;
  readonly onOpenCandidate: (candidateId: string) => void;
}) {
  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div><h2 style={{ margin: "0 0 0.35rem" }}>Candidate roster</h2></div>
      {props.candidates === null ? (
        <p style={{ color: "#555" }}>{props.loading ? "Loading candidates..." : "No roster loaded."}</p>
      ) : props.candidates.length === 0 ? (
        <div style={{ padding: "0.85rem", border: "1px solid #e5e7eb", borderRadius: "6px" }}>No candidates found.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
            <thead><tr style={{ background: "#f5f5f5" }}>{["Candidate", "Attempts", "Latest attempt", "Latest score", "Action"].map((heading) => (
              <th key={heading} style={{ textAlign: "left", padding: "0.55rem", borderBottom: "1px solid #ddd" }}>{heading}</th>
            ))}</tr></thead>
            <tbody>{props.candidates.map((candidate) => (
              <tr key={candidate.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "0.55rem", verticalAlign: "top" }}>
                  <div style={{ fontWeight: 700 }}>{candidate.name}</div><div style={{ color: "#555" }}>{candidate.email}</div>
                  <div style={{ color: "#666", fontSize: "0.78rem" }}>Created {formatAdminUtcTimestamp(candidate.createdAt)}</div>
                </td>
                <td style={{ padding: "0.55rem", verticalAlign: "top" }}>{formatAttemptSummary(candidate.attemptSummary)}</td>
                <td style={{ padding: "0.55rem", verticalAlign: "top" }}>{candidate.latestAttempt ? <>
                  <div>{candidate.latestAttempt.examTitle}</div><div style={{ color: "#555" }}>{formatAdminAttemptStatus(candidate.latestAttempt.status)}</div>
                  <div style={{ color: "#666", fontSize: "0.78rem" }}>{formatAdminUtcTimestamp(candidate.latestAttempt.scheduledFor)}</div>
                </> : "No attempts"}</td>
                <td style={{ padding: "0.55rem", verticalAlign: "top" }}><div>{formatCandidateScore(candidate.latestScore)}</div>{candidate.latestScore ? (
                  <div style={{ color: "#666", fontSize: "0.78rem" }}>Retrieved {formatAdminUtcTimestamp(candidate.latestScore.retrievedAt)}</div>
                ) : null}</td>
                <td style={{ padding: "0.55rem", verticalAlign: "top" }}><button type="button" onClick={() => props.onOpenCandidate(candidate.id)} disabled={props.loading} style={{ padding: "0.4rem 0.75rem" }}>View History</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {props.selectedCandidate ? (
        <section aria-label="Candidate exam history" style={{ border: "1px solid #d9e2ef", borderRadius: "6px", padding: "1rem", background: "#f8fafc" }}>
          <div style={{ marginBottom: "0.75rem" }}><h3 style={{ margin: "0 0 0.25rem" }}>{props.selectedCandidate.name}</h3><div style={{ color: "#555" }}>{props.selectedCandidate.email}</div></div>
          {props.selectedCandidate.attempts.length === 0 ? <p style={{ margin: 0, color: "#555" }}>This candidate has no exam attempts yet.</p> : (
            <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
              <thead><tr style={{ background: "#fff" }}>{["Exam", "Status", "Scheduled", "Completed", "Score"].map((heading) => <th key={heading} style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid #d7dce4" }}>{heading}</th>)}</tr></thead>
              <tbody>{props.selectedCandidate.attempts.map((attempt) => <tr key={attempt.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
                <td style={{ padding: "0.5rem", verticalAlign: "top" }}><div>{attempt.examTitle}</div><div style={{ color: "#666", fontSize: "0.78rem", fontFamily: "monospace" }}>{attempt.id}</div></td>
                <td style={{ padding: "0.5rem", verticalAlign: "top" }}>{formatAdminAttemptStatus(attempt.status)}</td>
                <td style={{ padding: "0.5rem", verticalAlign: "top" }}>{formatAdminUtcTimestamp(attempt.scheduledFor)}</td>
                <td style={{ padding: "0.5rem", verticalAlign: "top" }}>{formatAdminUtcTimestamp(attempt.completedAt)}</td>
                <td style={{ padding: "0.5rem", verticalAlign: "top" }}><div>{formatCandidateScore(attempt.score)}</div>{attempt.scoreRetrievalEnabled && !attempt.score ? <div style={{ color: "#666", fontSize: "0.78rem" }}>Score retrieval enabled, no persisted score yet.</div> : null}</td>
              </tr>)}</tbody>
            </table></div>
          )}
        </section>
      ) : null}
    </div>
  );
}

export function AdminCandidateRosterFeature(props: {
  readonly active: boolean;
  readonly fetchAdmin: AdminAuthenticatedRequest;
  readonly onBusyChange?: (busy: boolean) => void;
}) {
  const [candidateFirstName, setCandidateFirstName] = useState("");
  const [candidateLastName, setCandidateLastName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [candidatePassword, setCandidatePassword] = useState("");
  const [candidateMessage, setCandidateMessage] = useState<string | null>(null);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [candidateRoster, setCandidateRoster] = useState<AdminCandidateRosterItem[] | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<AdminCandidateDetail | null>(null);
  const [candidateError, setCandidateError] = useState<CandidateErrorState | null>(null);
  const [loading, setLoading] = useState(false);

  function setBusy(busy: boolean) {
    setLoading(busy);
    props.onBusyChange?.(busy);
  }

  async function loadCandidates(search = candidateSearch) {
    setBusy(true);
    setCandidateError(null);
    try {
      const trimmedSearch = search.trim();
      const query = trimmedSearch ? `?search=${encodeURIComponent(trimmedSearch)}` : "";
      const response = await props.fetchAdmin(`/api/admin/candidates${query}`);
      const data = await response.json() as { candidates?: AdminCandidateRosterItem[]; error?: string };
      if (!response.ok) {
        setCandidateError({ message: data.error ?? "Failed to load candidates" });
        return;
      }
      setCandidateRoster(data.candidates ?? []);
      if (selectedCandidate && !(data.candidates ?? []).some((candidate) => candidate.id === selectedCandidate.id)) {
        setSelectedCandidate(null);
      }
    } catch (caughtError) {
      if (!isAdminSessionExpiredError(caughtError)) setCandidateError({ message: "Failed to load candidates" });
    } finally {
      setBusy(false);
    }
  }

  async function loadCandidateDetail(candidateId: string) {
    setBusy(true);
    setCandidateError(null);
    try {
      const response = await props.fetchAdmin(`/api/admin/candidates/${encodeURIComponent(candidateId)}`);
      const data = await response.json() as { candidate?: AdminCandidateDetail; error?: string };
      if (!response.ok) {
        setCandidateError({ message: data.error ?? "Failed to load candidate history" });
        return;
      }
      setSelectedCandidate(data.candidate ?? null);
    } catch (caughtError) {
      if (!isAdminSessionExpiredError(caughtError)) setCandidateError({ message: "Failed to load candidate history" });
    } finally {
      setBusy(false);
    }
  }

  async function createCandidate() {
    setBusy(true);
    setCandidateError(null);
    setCandidateMessage(null);
    try {
      const response = await props.fetchAdmin("/api/admin/candidates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ firstName: candidateFirstName, lastName: candidateLastName, email: candidateEmail, password: candidatePassword }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) {
        setCandidateError({ message: data.error ?? "Failed to create Candidate" });
        return;
      }
      setCandidateFirstName("");
      setCandidateLastName("");
      setCandidateEmail("");
      setCandidatePassword("");
      setCandidateMessage("Candidate account created.");
      await loadCandidates();
    } catch (caughtError) {
      if (!isAdminSessionExpiredError(caughtError)) setCandidateError({ message: "Failed to create Candidate" });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (props.active) {
      void loadCandidates();
    } else {
      setCandidateError(null);
      setCandidateMessage(null);
    }
    // The authenticated adapter is stable for the lifetime of the admin shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.active]);

  if (!props.active) return null;

  return (
    <section style={{ display: "grid", gap: "1rem" }}>
      {candidateError ? <div style={{ ...alertPanelStyle.danger, display: "grid", gap: "0.5rem" }}><div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start" }}><p style={{ margin: 0 }}>{candidateError.message}</p><button type="button" onClick={() => setCandidateError(null)} style={{ padding: "0.25rem 0.55rem" }}>Dismiss</button></div></div> : null}
      <div style={{ ...mutedPanelStyle, display: "grid", gap: "0.9rem" }}>
        <div><h2 style={{ marginTop: 0, marginBottom: "0.35rem", fontSize: "1rem" }}>Provision Candidate</h2></div>
        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <label style={{ display: "grid", gap: "0.35rem" }}><span>First name</span><input value={candidateFirstName} onChange={(event) => setCandidateFirstName(event.target.value)} autoComplete="given-name" minLength={2} style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }} /></label>
          <label style={{ display: "grid", gap: "0.35rem" }}><span>Last name</span><input value={candidateLastName} onChange={(event) => setCandidateLastName(event.target.value)} autoComplete="family-name" minLength={2} style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }} /></label>
          <label style={{ display: "grid", gap: "0.35rem" }}><span>Candidate email</span><input value={candidateEmail} onChange={(event) => setCandidateEmail(event.target.value)} autoComplete="email" style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }} /></label>
          <label style={{ display: "grid", gap: "0.35rem" }}><span>Temporary password</span><input type="password" value={candidatePassword} onChange={(event) => setCandidatePassword(event.target.value)} autoComplete="new-password" style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }} /></label>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}><button onClick={() => void createCandidate()} disabled={loading} style={primaryButtonStyle}>Create Candidate</button>{candidateMessage ? <span style={{ color: "#0a7a28" }}>{candidateMessage}</span> : null}</div>
      </div>
      <div style={{ padding: "1rem", background: "#f7f7f8", borderRadius: "6px", display: "grid", gap: "0.9rem" }}>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "end", flexWrap: "wrap" }}><label style={{ display: "grid", gap: "0.35rem", flex: "1 1 18rem" }}><span>Search candidates</span><input value={candidateSearch} onChange={(event) => setCandidateSearch(event.target.value)} placeholder="Name or email" style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }} /></label><button type="button" onClick={() => void loadCandidates()} disabled={loading} style={{ padding: "0.55rem 0.9rem" }}>Search Candidates</button></div>
        <AdminCandidateRosterPanel candidates={candidateRoster} selectedCandidate={selectedCandidate} loading={loading} onOpenCandidate={(candidateId) => void loadCandidateDetail(candidateId)} />
      </div>
    </section>
  );
}
