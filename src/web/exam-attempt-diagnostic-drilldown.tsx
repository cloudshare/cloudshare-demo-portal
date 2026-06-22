import React from "react";
import type {
  ExamAttemptDiagnosticDrilldownReadModel,
  ExamAttemptDiagnosticTimelineEntry,
} from "@/api/admin-exam-attempt-diagnostics";

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

function renderStructured(value: Record<string, unknown> | Record<string, string> | null): string {
  if (!value || Object.keys(value).length === 0) {
    return "Unavailable";
  }
  return JSON.stringify(value, null, 2);
}

function buildTimelineDomId(entry: ExamAttemptDiagnosticTimelineEntry): string {
  return `exam-attempt-diagnostic-entry-${entry.id}`;
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
              <div>
                <strong>Training ID:</strong> {renderOptional(drilldown.cloudShare.trainingId)}
              </div>
              <div>
                <strong>Experience ID:</strong> {renderOptional(drilldown.cloudShare.experienceId)}
              </div>
              <div>
                <strong>Environment external ID:</strong> {renderOptional(drilldown.cloudShare.environmentExternalId)}
              </div>
              <div>
                <strong>Environment ID:</strong> {renderOptional(drilldown.cloudShare.environmentId)}
              </div>
              <div>
                <strong>Participant ID:</strong> {renderOptional(drilldown.cloudShare.participantId)}
              </div>
            </div>
          </section>

          <section>
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem" }}>Timeline</h3>
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
                        <strong>CloudShare / external IDs:</strong> {renderStructured(entry.externalIds)}
                      </div>
                      <div>
                        <strong>Request / response:</strong> {entry.requestResponseSummary}
                      </div>
                      <div>
                        <strong>Message:</strong> {entry.message}
                      </div>
                      <div>
                        <strong>Request</strong>
                        <pre style={{ margin: "0.25rem 0 0", whiteSpace: "pre-wrap" }}>
                          {renderStructured(entry.request)}
                        </pre>
                      </div>
                      <div>
                        <strong>Response</strong>
                        <pre style={{ margin: "0.25rem 0 0", whiteSpace: "pre-wrap" }}>
                          {renderStructured(entry.response)}
                        </pre>
                      </div>
                      <div>
                        <strong>Details</strong>
                        <pre style={{ margin: "0.25rem 0 0", whiteSpace: "pre-wrap" }}>
                          {renderStructured(entry.details)}
                        </pre>
                      </div>
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
