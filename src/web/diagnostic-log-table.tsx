import React, { Fragment, useMemo } from "react";
import {
  deriveDiagnosticQuickFacts,
  deriveDiagnosticSupportHints,
} from "./diagnostic-support-hints";

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
  readonly onOpenExamAttempt?: (examAttemptId: string) => void;
}

export const MAX_RENDERED_DETAIL_CHARS = 12_000;

function hasStructuredContent(value: Record<string, unknown> | Record<string, string> | null | undefined): boolean {
  return !!value && Object.keys(value).length > 0;
}

export function formatStructuredValue(value: Record<string, unknown> | Record<string, string>): {
  readonly text: string;
  readonly truncated: boolean;
  readonly omittedCharacters: number;
} {
  const pretty = JSON.stringify(value, null, 2);
  if (pretty.length <= MAX_RENDERED_DETAIL_CHARS) {
    return { text: pretty, truncated: false, omittedCharacters: 0 };
  }

  return {
    text: `${pretty.slice(0, MAX_RENDERED_DETAIL_CHARS)}\n... truncated`,
    truncated: true,
    omittedCharacters: pretty.length - MAX_RENDERED_DETAIL_CHARS,
  };
}

function formatActor(actor: DiagnosticLogTableEntry["actor"]): string {
  return actor ? `${actor.type}${actor.email ? ` (${actor.email})` : ""}` : "—";
}

function formatSubject(subject: DiagnosticLogTableEntry["subject"]): string {
  return subject ? `${subject.type}${subject.id ? ` (${subject.id})` : ""}` : "—";
}

function getDisplayExternalIds(
  externalIds: DiagnosticLogTableEntry["externalIds"],
): DiagnosticLogTableEntry["externalIds"] {
  if (!externalIds || Object.keys(externalIds).length === 0) {
    return externalIds;
  }

  const displayIds = { ...externalIds };
  const experienceId =
    displayIds.experienceId ??
    [displayIds.trainingId, displayIds.salesId].find((value) => isCloudShareExperienceId(value)) ??
    null;

  if (experienceId && !displayIds.experienceId) {
    displayIds.experienceId = experienceId;
  }

  if (displayIds.experienceId) {
    if (displayIds.trainingId === displayIds.experienceId) {
      delete displayIds.trainingId;
    }
    if (displayIds.salesId === displayIds.experienceId) {
      delete displayIds.salesId;
    }
  }

  return displayIds;
}

function isCloudShareExperienceId(value: string | undefined): boolean {
  return typeof value === "string" && value.startsWith("EX");
}

function formatExternalIds(externalIds: DiagnosticLogTableEntry["externalIds"]): string {
  const displayIds = getDisplayExternalIds(externalIds);

  if (!displayIds || Object.keys(displayIds).length === 0) {
    return "—";
  }
  return Object.entries(displayIds)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");
}

function readIntegrationSurface(details: DiagnosticLogTableEntry["details"]): string | null {
  return typeof details?.integrationSurface === "string" ? details.integrationSurface : null;
}

function summariseRequestResponse(entry: DiagnosticLogTableEntry): string {
  const method = typeof entry.request?.method === "string" ? entry.request.method : null;
  const path = typeof entry.request?.path === "string" ? entry.request.path : null;
  const status =
    typeof entry.response?.status === "number"
      ? `HTTP ${entry.response.status}`
      : typeof entry.response?.status === "string"
        ? `HTTP ${entry.response.status}`
        : null;

  const summary = [method, path].filter((value): value is string => !!value).join(" ");
  if (summary && status) {
    return `${summary} -> ${status}`;
  }
  if (summary) {
    return summary;
  }
  if (status) {
    return status;
  }
  return "—";
}

function StructuredDetailBlock(props: {
  readonly label: string;
  readonly value: Record<string, unknown> | Record<string, string>;
}) {
  const formatted = useMemo(() => formatStructuredValue(props.value), [props.value]);

  return (
    <div>
      <strong>{props.label}</strong>
      <pre
        style={{
          margin: "0.25rem 0 0.75rem",
          whiteSpace: "pre-wrap",
          maxHeight: "20rem",
          overflow: "auto",
        }}
      >
        {formatted.text}
      </pre>
      {formatted.truncated && (
        <div style={{ marginTop: "-0.5rem", marginBottom: "0.75rem", color: "#666" }}>
          Detail output truncated in the table view ({formatted.omittedCharacters.toLocaleString()} more characters omitted).
        </div>
      )}
    </div>
  );
}

function QuickFactsBlock(props: {
  readonly facts: readonly { label: string; value: string }[];
}) {
  return (
    <div style={{ marginBottom: "0.9rem" }}>
      <strong>Quick facts</strong>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "max-content 1fr",
          gap: "0.2rem 0.75rem",
          marginTop: "0.35rem",
        }}
      >
        {props.facts.map((fact) => (
          <Fragment key={`${fact.label}:${fact.value}`}>
            <span style={{ color: "#555" }}>{fact.label}</span>
            <span>{fact.value}</span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function SupportHintsBlock(props: {
  readonly hints: readonly { title: string; body: string }[];
}) {
  return (
    <div style={{ marginBottom: "0.9rem" }}>
      <strong>Support hints</strong>
      <div style={{ marginTop: "0.35rem" }}>
        {props.hints.map((hint) => (
          <div key={hint.title} style={{ marginBottom: "0.5rem" }}>
            <div style={{ fontWeight: 600 }}>{hint.title}</div>
            <div style={{ marginTop: "0.15rem", color: "#444" }}>{hint.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DiagnosticLogTable({
  entries,
  expandedDiagnosticId,
  onToggleExpanded,
  onOpenExamAttempt,
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
            <th style={{ padding: "0.4rem" }}>Exam</th>
            <th style={{ padding: "0.4rem" }}>Attempt</th>
            <th style={{ padding: "0.4rem" }}>CloudShare IDs</th>
            <th style={{ padding: "0.4rem" }}>Correlation</th>
            <th style={{ padding: "0.4rem" }}>Request / Response</th>
            <th style={{ padding: "0.4rem" }}>Message</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 && (
            <tr>
              <td colSpan={15} style={{ padding: "0.75rem", color: "#666" }}>
                No diagnostic entries yet.
              </td>
            </tr>
          )}
          {entries.map((entry) => {
            const isExpanded = expandedDiagnosticId === entry.id;
            const displayExternalIds = getDisplayExternalIds(entry.externalIds);
            const integrationSurface = readIntegrationSurface(entry.details);
            const hints = deriveDiagnosticSupportHints(entry);
            const quickFacts = deriveDiagnosticQuickFacts(entry);
            const sections = [
              hasStructuredContent(displayExternalIds) ? { label: "External IDs", value: displayExternalIds! } : null,
              hasStructuredContent(entry.request) ? { label: "Request", value: entry.request! } : null,
              hasStructuredContent(entry.response) ? { label: "Response", value: entry.response! } : null,
              hasStructuredContent(entry.details) ? { label: "Details", value: entry.details! } : null,
            ].filter((section): section is { label: string; value: Record<string, unknown> | Record<string, string> } => section !== null);

            return (
              <Fragment key={entry.id}>
                <tr
                  style={{ borderBottom: "1px solid #eee", verticalAlign: "top", cursor: "pointer" }}
                  onClick={() => onToggleExpanded(entry.id)}
                >
                  <td style={{ padding: "0.4rem", fontFamily: "monospace", whiteSpace: "nowrap", cursor: "pointer" }}>
                    {isExpanded ? "▼ " : "▶ "}
                    {entry.occurredAt}
                  </td>
                  <td style={{ padding: "0.4rem" }}>{entry.level}</td>
                  <td style={{ padding: "0.4rem" }}>{entry.source}</td>
                  <td style={{ padding: "0.4rem", fontFamily: "monospace" }}>
                    <div>{entry.operation}</div>
                    {integrationSurface ? (
                      <div style={{ marginTop: "0.2rem", color: "#666", fontSize: "0.75rem" }}>
                        Surface: {integrationSurface}
                      </div>
                    ) : null}
                  </td>
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
                  <td style={{ padding: "0.4rem", fontFamily: "monospace" }}>{entry.examId ?? "—"}</td>
                  <td style={{ padding: "0.4rem", fontFamily: "monospace" }}>
                    {entry.examAttemptId && onOpenExamAttempt ? (
                      <button
                        type="button"
                        aria-label={`Filter Support Diagnostics by ExamAttempt ${entry.examAttemptId}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenExamAttempt(entry.examAttemptId!);
                        }}
                        style={{
                          padding: 0,
                          border: "none",
                          background: "transparent",
                          color: "#0b57d0",
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {entry.examAttemptId}
                      </button>
                    ) : (
                      entry.examAttemptId ?? "—"
                    )}
                  </td>
                  <td style={{ padding: "0.4rem" }}>{formatExternalIds(displayExternalIds)}</td>
                  <td style={{ padding: "0.4rem", fontFamily: "monospace" }}>{entry.correlationId ?? "—"}</td>
                  <td style={{ padding: "0.4rem", fontFamily: "monospace" }}>{summariseRequestResponse(entry)}</td>
                  <td style={{ padding: "0.4rem" }}>{entry.message}</td>
                </tr>
                {isExpanded && (
                  <tr key={`${entry.id}-detail`}>
                    <td colSpan={15} style={{ padding: "0.5rem 1rem", background: "#f7f7f7", fontFamily: "monospace", fontSize: "0.78rem" }}>
                      {hints.length > 0 ? <SupportHintsBlock hints={hints} /> : null}
                      {quickFacts.length > 0 ? <QuickFactsBlock facts={quickFacts} /> : null}
                      {sections.length > 0 ? (
                        sections.map((section) => (
                          <StructuredDetailBlock key={section.label} label={section.label} value={section.value} />
                        ))
                      ) : (
                        <span style={{ color: "#888" }}>No additional detail.</span>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
