import React from "react";
import type {
  ExamAttemptDiagnosticDrilldownReadModel,
  ExamAttemptDiagnosticTimelineEntry,
} from "@/api/admin-exam-attempt-diagnostics";
import { formatStructuredValue } from "./diagnostic-log-table";

export interface ExamAttemptDiagnosticDrilldownProps {
  readonly drilldown: ExamAttemptDiagnosticDrilldownReadModel | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
}

function renderOptional(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : "Unavailable";
}

function renderBoolean(value: boolean): string {
  return value ? "Enabled" : "Disabled";
}

function renderCandidateName(firstName: string | null, lastName: string | null): string {
  const fullName = [firstName?.trim(), lastName?.trim()].filter(Boolean).join(" ");
  return fullName || "Unavailable";
}

function buildCloudShareIdRows(
  cloudShare: ExamAttemptDiagnosticDrilldownReadModel["cloudShare"],
): Array<{ label: string; value: string | null }> {
  const trainingId = cloudShare.trainingId?.trim() || null;
  const experienceId = cloudShare.experienceId?.trim() || trainingId;

  return [
    { label: "Experience ID", value: experienceId },
    ...(trainingId && trainingId !== experienceId ? [{ label: "Training ID", value: trainingId }] : []),
    { label: "Environment external ID", value: cloudShare.environmentExternalId },
    { label: "Environment ID", value: cloudShare.environmentId },
    { label: "Participant ID", value: cloudShare.participantId },
  ];
}

function buildTimelineDomId(entry: ExamAttemptDiagnosticTimelineEntry): string {
  return `exam-attempt-diagnostic-entry-${entry.id}`;
}

function StructuredDetailBlock(props: {
  readonly label: string;
  readonly value: Record<string, unknown> | Record<string, string> | null;
}) {
  if (!props.value || Object.keys(props.value).length === 0) {
    return (
      <div>
        <strong>{props.label}</strong>
        <div style={{ marginTop: "0.25rem" }}>Unavailable</div>
      </div>
    );
  }

  const formatted = formatStructuredValue(props.value);

  return (
    <div>
      <strong>{props.label}</strong>
      <pre style={{ margin: "0.25rem 0 0", whiteSpace: "pre-wrap", maxHeight: "20rem", overflow: "auto" }}>
        {formatted.text}
      </pre>
      {formatted.truncated ? (
        <div style={{ marginTop: "0.35rem", color: "#666" }}>
          Detail output truncated in the drilldown view ({formatted.omittedCharacters.toLocaleString()} more characters omitted).
        </div>
      ) : null}
    </div>
  );
}

export function ExamAttemptDiagnosticDrilldown({
  drilldown,
  loading,
  error,
  onClose,
}: ExamAttemptDiagnosticDrilldownProps) {
  if (!loading && !error && !drilldown) {
    return null;
  }

  return (
    <aside
      aria-label="ExamAttempt diagnostic drilldown"
      style={{
        marginTop: "1rem",
        border: "1px solid #d6d6db",
        borderRadius: "8px",
        padding: "1rem",
        background: "#fcfcfd",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "0.75rem",
          alignItems: "center",
          marginBottom: "0.75rem",
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: "1rem" }}>ExamAttempt diagnostic drilldown</h2>
          <div style={{ color: "#555", marginTop: "0.25rem", fontSize: "0.9rem" }}>
            Candidate, Exam, and CloudShare context with a chronological DiagnosticLogEntry thread.
          </div>
        </div>
        <button type="button" onClick={onClose} style={{ padding: "0.35rem 0.75rem" }}>
          Close
        </button>
      </div>

      {loading ? (
        <div>Loading diagnostic drilldown...</div>
      ) : error ? (
        <div style={{ color: "#b00020" }}>{error}</div>
      ) : drilldown ? (
        <div style={{ display: "grid", gap: "1rem" }}>
          <section>
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem" }}>Context summary</h3>
            <div style={{ display: "grid", gap: "0.35rem", fontSize: "0.9rem" }}>
              <div>
                <strong>Candidate:</strong> {drilldown.candidate.email} ({renderCandidateName(
                  drilldown.candidate.firstName,
                  drilldown.candidate.lastName,
                )})
              </div>
              <div>
                <strong>Exam:</strong> {drilldown.exam.title} ({drilldown.exam.id})
              </div>
              <div>
                <strong>Attempt status:</strong> {drilldown.attempt.status}
              </div>
              <div>
                <strong>Scheduled (UTC):</strong> {renderOptional(drilldown.attempt.scheduledFor)}
              </div>
              <div>
                <strong>Scoring:</strong> {renderBoolean(drilldown.exam.scoreRetrievalEnabled)}
              </div>
            </div>
          </section>

          <section>
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem" }}>CloudShare IDs</h3>
            <div style={{ display: "grid", gap: "0.35rem", fontSize: "0.9rem" }}>
              {buildCloudShareIdRows(drilldown.cloudShare).map((row) => (
                <div key={row.label}>
                  <strong>{row.label}:</strong> {renderOptional(row.value)}
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem" }}>Timeline</h3>
            {drilldown.timelinePage.hasMore ? (
              <div style={{ marginBottom: "0.75rem", color: "#666", fontSize: "0.88rem" }}>
                Showing the first {drilldown.timelinePage.returned} timeline entries. Older diagnostic rows remain available in Support Diagnostics filters.
              </div>
            ) : null}
            <div style={{ display: "grid", gap: "0.75rem" }}>
              {drilldown.timeline.length === 0 ? (
                <div style={{ color: "#666" }}>No DiagnosticLogEntry rows recorded for this ExamAttempt yet.</div>
              ) : (
                drilldown.timeline.map((entry) => (
                  <details
                    key={entry.id}
                    id={buildTimelineDomId(entry)}
                    data-timeline-entry-id={entry.id}
                    style={{
                      border: "1px solid #e2e2e7",
                      borderRadius: "8px",
                      padding: "0.75rem 0.85rem",
                      background: "#fff",
                    }}
                  >
                    <summary style={{ cursor: "pointer" }}>
                      <strong>{entry.operation}</strong> · {entry.outcome} · {entry.occurredAt}
                    </summary>
                    <div style={{ display: "grid", gap: "0.35rem", marginTop: "0.65rem", fontSize: "0.88rem" }}>
                      <div>
                        <strong>Source:</strong> {entry.source}
                      </div>
                      <div>
                        <strong>Integration surface:</strong> {renderOptional(entry.integrationSurface)}
                      </div>
                      <div>
                        <strong>Correlation ID:</strong> {renderOptional(entry.correlationId)}
                      </div>
                      <div>
                        <strong>CloudShare / external IDs:</strong>{" "}
                        {entry.externalIds && Object.keys(entry.externalIds).length > 0
                          ? JSON.stringify(entry.externalIds)
                          : "Unavailable"}
                      </div>
                      <div>
                        <strong>Request / response:</strong> {entry.requestResponseSummary}
                      </div>
                      <div>
                        <strong>Message:</strong> {entry.message}
                      </div>
                      <StructuredDetailBlock label="Request" value={entry.request} />
                      <StructuredDetailBlock label="Response" value={entry.response} />
                      <StructuredDetailBlock label="Details" value={entry.details} />
                    </div>
                  </details>
                ))
              )}
            </div>
          </section>
        </div>
      ) : null}
    </aside>
  );
}
