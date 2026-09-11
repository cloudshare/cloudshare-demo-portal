import React, { Fragment, useMemo } from "react";
import {
  deriveDiagnosticQuickFacts,
  deriveDiagnosticSupportHints,
} from "./diagnostic-support-hints";
import { colors } from "./design-tokens";
import { statusBadgeStyle, getDiagnosticLevelTone, getOutcomeTone } from "./status-badge";

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

const CELL_PADDING = "0.55rem 0.6rem";
const DIAGNOSTIC_TABLE_MIN_WIDTH = "115rem";
const OCCURRED_COLUMN_WIDTH = "16rem";
const OCCURRED_TIMESTAMP_MIN_WIDTH = "12rem";
const HEADER_CELL_STYLE = {
  padding: CELL_PADDING,
  textAlign: "left" as const,
  verticalAlign: "bottom" as const,
};
const BODY_CELL_STYLE = {
  padding: CELL_PADDING,
  verticalAlign: "top" as const,
  borderBottom: `1px solid ${colors.border}`,
  lineHeight: 1.45,
};
const MUTED_TEXT_STYLE = {
  color: colors.textSecondary,
  fontSize: "0.74rem",
  lineHeight: 1.35,
};

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
  if (typeof details?.integrationSurface !== "string") return null;
  const surface = details.integrationSurface.trim();
  return surface.length > 0 ? surface : null;
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
  readonly label?: string;
  readonly value: Record<string, unknown> | Record<string, string>;
}) {
  const formatted = useMemo(() => formatStructuredValue(props.value), [props.value]);

  return (
    <div>
      {props.label ? <strong>{props.label}</strong> : null}
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
        <div style={{ marginTop: "-0.5rem", marginBottom: "0.75rem", color: colors.textSecondary }}>
          Detail output truncated in the table view ({formatted.omittedCharacters.toLocaleString()} more characters omitted).
        </div>
      )}
    </div>
  );
}

function ResponseDetailBlock(props: {
  readonly response: Record<string, unknown> | null | undefined;
  readonly cachedPrior: boolean;
}) {
  if (!props.response || !hasStructuredContent(props.response)) {
    return (
      <div>
        <strong>Response</strong>
        <div style={{ margin: "0.25rem 0 0.75rem" }}>No response received.</div>
      </div>
    );
  }

  return (
    <div>
      <strong>Response</strong>
      {props.cachedPrior ? (
        <div style={{ margin: "0.25rem 0", color: colors.textSecondary }}>
          Cached prior-response evidence; no new HTTP request was sent during cooldown.
        </div>
      ) : null}
      <StructuredDetailBlock label="" value={props.response} />
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
            <span style={{ color: colors.textSecondary }}>{fact.label}</span>
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

function renderTextValue(value: string | null | undefined, monospace = false): React.ReactNode {
  if (!value) {
    return <span style={{ color: "#888" }}>—</span>;
  }

  return (
    <span style={monospace ? { fontFamily: "monospace", wordBreak: "break-word" } : { wordBreak: "break-word" }}>
      {value}
    </span>
  );
}

/** CloudShare transport rows use the captured integration surface as their
 * operation label. This keeps Session and Trial rows comparable while
 * retaining endpoint/resource specificity supplied by the exchange. */
function operationLabel(entry: DiagnosticLogTableEntry): string {
  const surface = readIntegrationSurface(entry.details);
  if ((entry.operation === "cloudshare.request" || entry.operation === "sales_trial.cloudshare.request" || entry.operation === "cloudshare.oauth.token" || entry.operation === "sales_trial.cloudshare.oauth_token") && surface) return surface;
  return entry.operation;
}

export function DiagnosticLogTable({
  entries,
  expandedDiagnosticId,
  onToggleExpanded,
  onOpenExamAttempt,
}: DiagnosticLogTableProps) {
  return (
    <div
      style={{
        overflowX: "auto",
        border: "1px solid #dfe3eb",
        borderRadius: "8px",
        background: "#fff",
      }}
    >
      <table
        style={{
          width: "100%",
          minWidth: DIAGNOSTIC_TABLE_MIN_WIDTH,
          borderCollapse: "separate",
          borderSpacing: 0,
          tableLayout: "fixed",
          fontSize: "0.82rem",
        }}
      >
        <colgroup>
          <col style={{ width: OCCURRED_COLUMN_WIDTH }} />
          <col style={{ width: "5.25rem" }} />
          <col style={{ width: "7rem" }} />
          <col style={{ width: "12rem" }} />
          <col style={{ width: "6rem" }} />
          <col style={{ width: "8rem" }} />
          <col style={{ width: "11rem" }} />
          <col style={{ width: "10rem" }} />
          <col style={{ width: "12rem" }} />
          <col style={{ width: "7rem" }} />
          <col style={{ width: "8rem" }} />
          <col style={{ width: "14rem" }} />
          <col style={{ width: "9rem" }} />
          <col style={{ width: "12rem" }} />
          <col style={{ width: "14rem" }} />
        </colgroup>
        <thead>
          <tr style={{ background: "#f8fafc", color: "#4b5563" }}>
            <th colSpan={5} style={{ ...HEADER_CELL_STYLE, borderBottom: "1px solid #d7dce4", fontSize: "0.73rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Event
            </th>
            <th colSpan={6} style={{ ...HEADER_CELL_STYLE, borderBottom: "1px solid #d7dce4", fontSize: "0.73rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Support anchors
            </th>
            <th colSpan={4} style={{ ...HEADER_CELL_STYLE, borderBottom: "1px solid #d7dce4", fontSize: "0.73rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Correlation and evidence
            </th>
          </tr>
          <tr style={{ textAlign: "left", background: "#f8fafc" }}>
            <th style={{ ...HEADER_CELL_STYLE, borderBottom: "2px solid #d7dce4" }}>Occurred (UTC)</th>
            <th style={{ ...HEADER_CELL_STYLE, borderBottom: "2px solid #d7dce4" }}>Level</th>
            <th style={{ ...HEADER_CELL_STYLE, borderBottom: "2px solid #d7dce4" }}>Source</th>
            <th style={{ ...HEADER_CELL_STYLE, borderBottom: "2px solid #d7dce4" }}>Operation</th>
            <th style={{ ...HEADER_CELL_STYLE, borderBottom: "2px solid #d7dce4" }}>Outcome</th>
            <th style={{ ...HEADER_CELL_STYLE, borderBottom: "2px solid #d7dce4" }}>Customer</th>
            <th style={{ ...HEADER_CELL_STYLE, borderBottom: "2px solid #d7dce4" }}>Actor</th>
            <th style={{ ...HEADER_CELL_STYLE, borderBottom: "2px solid #d7dce4" }}>Subject</th>
            <th style={{ ...HEADER_CELL_STYLE, borderBottom: "2px solid #d7dce4" }}>Candidate</th>
            <th style={{ ...HEADER_CELL_STYLE, borderBottom: "2px solid #d7dce4" }}>Exam</th>
            <th style={{ ...HEADER_CELL_STYLE, borderBottom: "2px solid #d7dce4" }}>Attempt</th>
            <th style={{ ...HEADER_CELL_STYLE, borderBottom: "2px solid #d7dce4" }}>CloudShare IDs</th>
            <th style={{ ...HEADER_CELL_STYLE, borderBottom: "2px solid #d7dce4" }}>Correlation</th>
            <th style={{ ...HEADER_CELL_STYLE, borderBottom: "2px solid #d7dce4" }}>Request / Response</th>
            <th style={{ ...HEADER_CELL_STYLE, borderBottom: "2px solid #d7dce4" }}>Message</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 && (
            <tr>
              <td colSpan={15} style={{ padding: "0.85rem", color: colors.textSecondary }}>
                No diagnostic entries yet.
              </td>
            </tr>
          )}
          {entries.map((entry, index) => {
            const isExpanded = expandedDiagnosticId === entry.id;
            const displayExternalIds = getDisplayExternalIds(entry.externalIds);
            const integrationSurface = readIntegrationSurface(entry.details);
            const hints = deriveDiagnosticSupportHints(entry);
            const quickFacts = deriveDiagnosticQuickFacts(entry);
            const sections = [
              hasStructuredContent(displayExternalIds) ? { label: "External IDs", value: displayExternalIds! } : null,
              hasStructuredContent(entry.request) ? { label: "Request", value: entry.request! } : null,
              hasStructuredContent(entry.details) ? { label: "Details", value: entry.details! } : null,
            ].filter((section): section is { label: string; value: Record<string, unknown> | Record<string, string> } => section !== null);
            const isRequestDiagnostic = hasStructuredContent(entry.request);
            const hasCachedPriorResponse = entry.details?.responseEvidence === "cached_prior";
            const detailSection = sections.find((section) => section.label === "Details") ?? null;
            const evidenceSections = sections.filter((section) => section.label !== "Details");

            return (
              <Fragment key={entry.id}>
                <tr
                  style={{
                    verticalAlign: "top",
                    cursor: "pointer",
                    background: index % 2 === 0 ? "#fff" : "#fbfcfe",
                  }}
                  onClick={() => onToggleExpanded(entry.id)}
                >
                  <td style={{ ...BODY_CELL_STYLE, fontFamily: "monospace" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
                      <button
                        type="button"
                        aria-label={`${isExpanded ? "Collapse" : "Expand"} diagnostic entry ${entry.id}`}
                        aria-expanded={isExpanded}
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleExpanded(entry.id);
                        }}
                        style={{
                          width: "1.5rem",
                          height: "1.5rem",
                          border: "1px solid #cfd6e4",
                          borderRadius: "4px",
                          background: "#fff",
                          color: "#334155",
                          cursor: "pointer",
                          flex: "0 0 auto",
                          fontFamily: "inherit",
                        }}
                      >
                        {isExpanded ? "▼" : "▶"}
                      </button>
                      <div style={{ minWidth: OCCURRED_TIMESTAMP_MIN_WIDTH }}>
                        <div style={{ whiteSpace: "nowrap" }}>{entry.occurredAt}</div>
                        {(() => { const d = entry.details ?? {}; const kind = d.evidenceKind === "semantic" ? "Semantic" : d.evidenceKind === "transport" ? "Transport" : "Legacy"; const oauth = entry.operation === "cloudshare.oauth.token" || String(d.integrationSurface ?? "").includes("oauth"); return <div style={MUTED_TEXT_STYLE}>{kind} evidence{oauth ? " · OAuth metadata-only" : ""}{d.exchangeId ? ` · exchange ${String(d.exchangeId)}` : ""}{d.attemptStartSequence ? ` · start #${String(d.attemptStartSequence)}` : ""}{d.completedAt ? ` · completed ${String(d.completedAt)}` : ""}{d.durationMs !== undefined ? ` · ${String(d.durationMs)}ms` : ""}</div>; })()}
                        <div style={MUTED_TEXT_STYLE}>{isExpanded ? "Evidence expanded" : "Expand for evidence"}</div>
                      </div>
                    </div>
                  </td>
                  <td style={BODY_CELL_STYLE}>
                    <span
                      style={{
                        ...statusBadgeStyle(getDiagnosticLevelTone(entry.level)),
                        textTransform: "uppercase",
                        fontSize: "0.72rem",
                      }}
                    >
                      {entry.level}
                    </span>
                  </td>
                  <td style={BODY_CELL_STYLE}>{renderTextValue(entry.source)}</td>
                  <td style={{ ...BODY_CELL_STYLE, fontFamily: "monospace" }}>
                    <div style={{ wordBreak: "break-word" }}>{operationLabel(entry)}</div>
                    {integrationSurface ? (
                      <div style={{ marginTop: "0.2rem", ...MUTED_TEXT_STYLE }}>
                        Surface: {integrationSurface}
                      </div>
                    ) : null}
                  </td>
                  <td style={BODY_CELL_STYLE}>
                    <span style={statusBadgeStyle(getOutcomeTone(entry.outcome))}>
                      {entry.outcome}
                    </span>
                  </td>
                  <td style={BODY_CELL_STYLE}>{renderTextValue(entry.customerId, true)}</td>
                  <td style={BODY_CELL_STYLE}>{renderTextValue(formatActor(entry.actor))}</td>
                  <td style={BODY_CELL_STYLE}>{renderTextValue(formatSubject(entry.subject))}</td>
                  <td style={BODY_CELL_STYLE}>{renderTextValue(entry.candidateEmail)}</td>
                  <td style={BODY_CELL_STYLE}>{renderTextValue(entry.examId, true)}</td>
                  <td style={{ ...BODY_CELL_STYLE, fontFamily: "monospace" }}>
                    {entry.examAttemptId && onOpenExamAttempt ? (
                      <div style={{ display: "grid", gap: "0.2rem" }}>
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
                            textAlign: "left",
                            justifySelf: "start",
                          }}
                        >
                          {entry.examAttemptId}
                        </button>
                        <span style={MUTED_TEXT_STYLE}>Open filtered thread</span>
                      </div>
                    ) : (
                      renderTextValue(entry.examAttemptId, true)
                    )}
                  </td>
                  <td style={BODY_CELL_STYLE}>{renderTextValue(formatExternalIds(displayExternalIds))}</td>
                  <td style={BODY_CELL_STYLE}>{renderTextValue(entry.correlationId, true)}</td>
                  <td style={{ ...BODY_CELL_STYLE, fontFamily: "monospace" }}>{renderTextValue(summariseRequestResponse(entry), true)}</td>
                  <td style={BODY_CELL_STYLE}>
                    <div style={{ fontWeight: 600, color: "#1f2937", wordBreak: "break-word" }}>{entry.message}</div>
                  </td>
                </tr>
                {isExpanded && (
                  <tr key={`${entry.id}-detail`}>
                    <td
                      colSpan={15}
                      style={{
                        padding: "0.7rem 1rem 0.8rem",
                        background: colors.surfaceMuted,
                        fontFamily: "monospace",
                        fontSize: "0.78rem",
                        borderBottom: "1px solid #dfe3eb",
                      }}
                    >
                      {hints.length > 0 ? <SupportHintsBlock hints={hints} /> : null}
                      {quickFacts.length > 0 ? <QuickFactsBlock facts={quickFacts} /> : null}
                      {evidenceSections.map((section) => (
                        <StructuredDetailBlock key={section.label} label={section.label} value={section.value} />
                      ))}
                      {isRequestDiagnostic ? (
                        <ResponseDetailBlock response={entry.response} cachedPrior={hasCachedPriorResponse} />
                      ) : null}
                      {detailSection ? (
                        <StructuredDetailBlock label={detailSection.label} value={detailSection.value} />
                      ) : evidenceSections.length === 0 && !isRequestDiagnostic ? (
                        <span style={{ color: "#888" }}>No additional detail.</span>
                      ) : null}
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
