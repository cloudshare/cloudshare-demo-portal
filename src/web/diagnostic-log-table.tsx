import React, { Fragment } from "react";

export interface DiagnosticLogTableEntry {
  id: string;
  occurredAt: string;
  level: "debug" | "info" | "warn" | "error";
  source: string;
  operation: string;
  outcome: "success" | "failure";
  customerId: string | null;
  actor: { type: string; id?: string | null; email?: string | null } | null;
  subject: { type: string; id?: string | null } | null;
  message: string;
  correlationId: string | null;
  candidateEmail: string | null;
  examId: string | null;
  examAttemptId: string | null;
  externalIds?: Record<string, string> | null;
  request?: Record<string, unknown> | null;
  response?: Record<string, unknown> | null;
  details?: Record<string, unknown> | null;
}

export interface DiagnosticLogTableProps {
  readonly entries: readonly DiagnosticLogTableEntry[];
  readonly expandedDiagnosticId: string | null;
  readonly onToggleExpanded: (id: string) => void;
}

function formatActor(actor: DiagnosticLogTableEntry["actor"]): string {
  return actor ? `${actor.type}${actor.email ? ` (${actor.email})` : ""}` : "—";
}

function formatSubject(subject: DiagnosticLogTableEntry["subject"]): string {
  return subject ? `${subject.type}${subject.id ? ` (${subject.id})` : ""}` : "—";
}

export function DiagnosticLogTable({
  entries,
  expandedDiagnosticId,
  onToggleExpanded,
}: DiagnosticLogTableProps) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th style={{ padding: "0.4rem" }}>Occurred (UTC)</th>
            <th style={{ padding: "0.4rem" }}>Level</th>
            <th style={{ padding: "0.4rem" }}>Source</th>
            <th style={{ padding: "0.4rem" }}>Operation</th>
            <th style={{ padding: "0.4rem" }}>Outcome</th>
            <th style={{ padding: "0.4rem" }}>Customer</th>
            <th style={{ padding: "0.4rem" }}>Actor</th>
            <th style={{ padding: "0.4rem" }}>Subject</th>
            <th style={{ padding: "0.4rem" }}>Candidate</th>
            <th style={{ padding: "0.4rem" }}>Correlation</th>
            <th style={{ padding: "0.4rem" }}>Message</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 && (
            <tr>
              <td colSpan={11} style={{ padding: "0.75rem", color: "#666" }}>
                No diagnostic entries yet.
              </td>
            </tr>
          )}
          {entries.map((entry) => (
            <Fragment key={entry.id}>
              <tr
                style={{ borderBottom: "1px solid #eee", verticalAlign: "top", cursor: "pointer" }}
                onClick={() => onToggleExpanded(entry.id)}
              >
                <td style={{ padding: "0.4rem", fontFamily: "monospace", whiteSpace: "nowrap", cursor: "pointer" }}>
                  {expandedDiagnosticId === entry.id ? "▼ " : "▶ "}
                  {entry.occurredAt}
                </td>
                <td style={{ padding: "0.4rem" }}>{entry.level}</td>
                <td style={{ padding: "0.4rem" }}>{entry.source}</td>
                <td style={{ padding: "0.4rem", fontFamily: "monospace" }}>{entry.operation}</td>
                <td
                  style={{
                    padding: "0.4rem",
                    color: entry.outcome === "failure" ? "#b00020" : "#0a7",
                    fontWeight: 600,
                  }}
                >
                  {entry.outcome}
                </td>
                <td style={{ padding: "0.4rem", fontFamily: "monospace" }}>{entry.customerId ?? "—"}</td>
                <td style={{ padding: "0.4rem" }}>{formatActor(entry.actor)}</td>
                <td style={{ padding: "0.4rem" }}>{formatSubject(entry.subject)}</td>
                <td style={{ padding: "0.4rem" }}>{entry.candidateEmail ?? "—"}</td>
                <td style={{ padding: "0.4rem", fontFamily: "monospace" }}>{entry.correlationId ?? "—"}</td>
                <td style={{ padding: "0.4rem" }}>{entry.message}</td>
              </tr>
              {expandedDiagnosticId === entry.id && (
                <tr key={`${entry.id}-detail`}>
                  <td colSpan={11} style={{ padding: "0.5rem 1rem", background: "#f7f7f7", fontFamily: "monospace", fontSize: "0.78rem" }}>
                    {entry.externalIds && Object.keys(entry.externalIds).length > 0 && (
                      <div><strong>External IDs</strong><pre style={{ margin: "0.25rem 0 0.75rem", whiteSpace: "pre-wrap" }}>{JSON.stringify(entry.externalIds, null, 2)}</pre></div>
                    )}
                    {entry.request && Object.keys(entry.request).length > 0 && (
                      <div><strong>Request</strong><pre style={{ margin: "0.25rem 0 0.75rem", whiteSpace: "pre-wrap" }}>{JSON.stringify(entry.request, null, 2)}</pre></div>
                    )}
                    {entry.response && Object.keys(entry.response).length > 0 && (
                      <div><strong>Response</strong><pre style={{ margin: "0.25rem 0 0.75rem", whiteSpace: "pre-wrap" }}>{JSON.stringify(entry.response, null, 2)}</pre></div>
                    )}
                    {entry.details && Object.keys(entry.details).length > 0 && (
                      <div><strong>Details</strong><pre style={{ margin: "0.25rem 0 0.75rem", whiteSpace: "pre-wrap" }}>{JSON.stringify(entry.details, null, 2)}</pre></div>
                    )}
                    {!entry.externalIds && !entry.request && !entry.response && !entry.details && (
                      <span style={{ color: "#888" }}>No additional detail.</span>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
