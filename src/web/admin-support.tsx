"use client";

import React, { useEffect, useRef, useState } from "react";
import type { AdminAuthenticatedRequest } from "./admin-authenticated-request";
import { isAdminSessionExpiredError } from "./admin-authenticated-request";
import { buildDiagnosticLogQueryString } from "./admin-support-state";
import {
  createExamAttemptDiagnosticsNavigationIntent,
  normaliseDiagnosticLogFilters,
  type AdminNavigationIntent,
  type AdminSupportView,
  type DiagnosticLogFilters,
} from "./admin-shell-route";
import { formatAdminUtcTimestamp } from "./admin-attempt-presentation";
import {
  DiagnosticLogTable,
  type DiagnosticLogTableEntry as DiagnosticLogEntry,
} from "./diagnostic-log-table";
import { alertPanelStyle, cardStyle } from "./card-styles";
import { colors } from "./design-tokens";

const DIAGNOSTIC_PAGE_LIMIT = 50;
const extensionHydrationProps = { suppressHydrationWarning: true } as const;

interface AuditRecord {
  readonly id: string;
  readonly customerId?: string | null;
  readonly actorType?: string | null;
  readonly actorId?: string | null;
  readonly actorEmail?: string | null;
  readonly subjectType?: string | null;
  readonly subjectId?: string | null;
  readonly action: string;
  readonly outcome: "success" | "failure" | "denied";
  readonly candidateId?: string | null;
  readonly candidateEmail?: string | null;
  readonly examId?: string | null;
  readonly examAttemptId?: string | null;
  readonly correlationId?: string | null;
  readonly details?: Record<string, unknown> | null;
  readonly error?: string | null;
  readonly occurredAt: string;
}

interface AuditTrailFilters {
  readonly examAttemptId: string;
  readonly action: string;
  readonly outcome: string;
  readonly actorEmail: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly examId: string;
}

interface DiagnosticLogPageResponse {
  readonly limit: number;
  readonly offset: number;
  readonly returned: number;
  readonly hasMore: boolean;
  readonly nextOffset: number | null;
}

const EMPTY_AUDIT_FILTERS: AuditTrailFilters = {
  examAttemptId: "",
  action: "",
  outcome: "",
  actorEmail: "",
  subjectType: "",
  subjectId: "",
  examId: "",
};

export function AdminSupportFeature(props: {
  readonly active: boolean;
  readonly view: AdminSupportView;
  readonly diagnosticFilters: DiagnosticLogFilters;
  /** Filters supplied by a specialised support view that must never be relaxed by local controls. */
  readonly lockedDiagnosticFilters?: DiagnosticLogFilters;
  /** Specialised support views may use a narrower server-side diagnostic route. */
  readonly diagnosticsEndpoint?: string;
  readonly fetchAdmin: AdminAuthenticatedRequest;
  readonly onNavigate: (intent: AdminNavigationIntent) => void;
}) {
  const [auditFilters, setAuditFilters] = useState<AuditTrailFilters>(EMPTY_AUDIT_FILTERS);
  const [auditRecords, setAuditRecords] = useState<readonly AuditRecord[] | null>(null);
  const [diagnosticFilters, setDiagnosticFilters] = useState<DiagnosticLogFilters>(() => mergeLockedDiagnosticFilters(props.diagnosticFilters, props.lockedDiagnosticFilters));
  const [diagnosticEntries, setDiagnosticEntries] = useState<readonly DiagnosticLogEntry[] | null>(null);
  const [diagnosticPage, setDiagnosticPage] = useState<DiagnosticLogPageResponse | null>(null);
  const [expandedDiagnosticId, setExpandedDiagnosticId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appliedRouteFiltersRef = useRef<string | null>(null);
  const lockedDiagnosticFiltersKey = JSON.stringify(props.lockedDiagnosticFilters ?? {});

  async function loadAudit(filters: AuditTrailFilters = auditFilters) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        const trimmed = value.trim();
        if (trimmed) params.set(key, trimmed);
      }
      const query = params.toString();
      const response = await props.fetchAdmin(`/api/admin/audit${query ? `?${query}` : ""}`);
      const data = (await response.json()) as { records?: AuditRecord[]; error?: string };
      if (!response.ok) {
        setError(data.error ?? "Failed to load audit trail");
        return;
      }
      setAuditRecords(data.records ?? []);
    } catch (caughtError) {
      if (!isAdminSessionExpiredError(caughtError)) setError("Failed to load audit trail");
    } finally {
      setLoading(false);
    }
  }

  async function loadDiagnostics(offset = 0, filters: DiagnosticLogFilters = diagnosticFilters) {
    setLoading(true);
    setError(null);
    try {
      const effectiveFilters = mergeLockedDiagnosticFilters(filters, props.lockedDiagnosticFilters);
      const query = buildDiagnosticLogQueryString(effectiveFilters, {
        limit: DIAGNOSTIC_PAGE_LIMIT,
        offset,
      });
      const response = await props.fetchAdmin(`${props.diagnosticsEndpoint ?? "/api/admin/diagnostics"}${query}`);
      const data = (await response.json()) as {
        entries?: DiagnosticLogEntry[];
        page?: DiagnosticLogPageResponse;
        error?: string;
      };
      if (!response.ok) {
        setError(data.error ?? "Failed to load diagnostic log");
        return;
      }
      setDiagnosticEntries(data.entries ?? []);
      setDiagnosticPage(data.page ?? {
        limit: DIAGNOSTIC_PAGE_LIMIT,
        offset,
        returned: data.entries?.length ?? 0,
        hasMore: false,
        nextOffset: null,
      });
      setExpandedDiagnosticId(null);
    } catch (caughtError) {
      if (!isAdminSessionExpiredError(caughtError)) setError("Failed to load diagnostic log");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const effectiveRouteFilters = mergeLockedDiagnosticFilters(props.diagnosticFilters, props.lockedDiagnosticFilters);
    setDiagnosticFilters(effectiveRouteFilters);
    const routeFilters = JSON.stringify(effectiveRouteFilters);
    const wasExplicitlyApplied = appliedRouteFiltersRef.current === routeFilters;
    appliedRouteFiltersRef.current = null;
    if (props.active && props.view === "diagnostics" && !wasExplicitlyApplied) {
      void loadDiagnostics(0, effectiveRouteFilters);
    }
    // Route filters are shell-owned URL state; loading and presentation remain feature-owned.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.active, props.view, props.diagnosticFilters, lockedDiagnosticFiltersKey]);

  useEffect(() => {
    if (props.active && props.view === "audit") void loadAudit();
    // The authenticated adapter is stable for the lifetime of the admin shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.active, props.view]);

  useEffect(() => {
    if (!props.active) setError(null);
  }, [props.active]);

  if (!props.active || (props.view !== "diagnostics" && props.view !== "audit")) return null;

  function applyDiagnosticFilters() {
    const effectiveFilters = mergeLockedDiagnosticFilters(diagnosticFilters, props.lockedDiagnosticFilters);
    setDiagnosticFilters(effectiveFilters);
    props.onNavigate({ tab: "support", supportView: "diagnostics", diagnosticFilters: effectiveFilters });
    appliedRouteFiltersRef.current = JSON.stringify(effectiveFilters);
    void loadDiagnostics(0, effectiveFilters);
  }

  function clearDiagnosticFilters() {
    const effectiveFilters = mergeLockedDiagnosticFilters({}, props.lockedDiagnosticFilters);
    setDiagnosticFilters(effectiveFilters);
    props.onNavigate({ tab: "support", supportView: "diagnostics", diagnosticFilters: effectiveFilters });
    setDiagnosticPage(null);
    setExpandedDiagnosticId(null);
    if (props.lockedDiagnosticFilters) void loadDiagnostics(0, effectiveFilters);
  }

  function openExamAttemptDiagnostics(examAttemptId: string) {
    props.onNavigate(createExamAttemptDiagnosticsNavigationIntent(examAttemptId));
    setExpandedDiagnosticId(null);
  }

  if (props.view === "audit") {
    return (
      <section>
        {error ? <SupportError message={error} onDismiss={() => setError(null)} /> : null}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0.75rem", marginBottom: "1rem", alignItems: "end" }}>
          {(["examAttemptId", "action"] as const).map((key) => (
            <input key={key} placeholder={{ examAttemptId: "Exam attempt ID", action: "Action", actorEmail: "Actor email", subjectType: "Subject type", subjectId: "Subject ID", examId: "Exam ID" }[key]} value={auditFilters[key]} onChange={(event) => setAuditFilters((current) => ({ ...current, [key]: event.target.value }))} style={{ padding: "0.4rem" }} />
          ))}
          <select value={auditFilters.outcome} onChange={(event) => setAuditFilters((current) => ({ ...current, outcome: event.target.value }))} style={{ padding: "0.4rem" }}>
            <option value="">Any outcome</option><option value="success">Success</option><option value="failure">Failure</option><option value="denied">Denied</option>
          </select>
          {(["actorEmail", "subjectType", "subjectId", "examId"] as const).map((key) => (
            <input key={key} placeholder={{ actorEmail: "Actor email", subjectType: "Subject type", subjectId: "Subject ID", examId: "Exam ID" }[key]} value={auditFilters[key]} onChange={(event) => setAuditFilters((current) => ({ ...current, [key]: event.target.value }))} style={{ padding: "0.4rem" }} />
          ))}
          <button onClick={() => void loadAudit()} disabled={loading} style={{ padding: "0.4rem 1rem" }}>{loading ? "Loading..." : "Apply Filters"}</button>
          <button onClick={() => { setAuditFilters(EMPTY_AUDIT_FILTERS); void loadAudit(EMPTY_AUDIT_FILTERS); }} disabled={loading} style={{ padding: "0.4rem 1rem" }}>Clear Filters</button>
          <button onClick={() => void loadAudit()} disabled={loading} style={{ padding: "0.4rem 1rem" }}>Refresh Page</button>
        </div>
        {auditRecords ? <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}><thead><tr style={{ background: colors.surfaceSubtle }}>{["Time", "Actor", "Subject", "Exam attempt", "Action", "Outcome", "Details / Error"].map((heading) => <th key={heading} style={{ textAlign: "left", padding: "0.4rem", borderBottom: `1px solid ${colors.border}` }}>{heading}</th>)}</tr></thead><tbody>{auditRecords.length === 0 ? <tr><td colSpan={7} style={{ padding: "0.5rem", color: colors.textSecondary }}>No records found</td></tr> : auditRecords.map((record) => <tr key={record.id} style={{ borderBottom: `1px solid ${colors.border}` }}><td style={{ padding: "0.4rem", whiteSpace: "nowrap" }}>{formatAdminUtcTimestamp(record.occurredAt)}</td><td style={{ padding: "0.4rem" }}>{record.actorEmail ?? record.actorId ?? record.actorType ?? "-"}</td><td style={{ padding: "0.4rem" }}>{record.subjectType || record.subjectId ? `${record.subjectType ?? "subject"}:${record.subjectId ?? "-"}` : record.examId ?? "-"}</td><td style={{ padding: "0.4rem" }}>{record.examAttemptId ?? "-"}</td><td style={{ padding: "0.4rem" }}>{record.action}</td><td style={{ padding: "0.4rem", color: record.outcome === "success" ? colors.success : colors.danger, fontWeight: "bold" }}>{record.outcome}</td><td style={{ padding: "0.4rem", fontSize: "0.8rem", color: "#444" }}>{record.error ?? (record.details ? JSON.stringify(record.details) : "-")}</td></tr>)}</tbody></table></div> : null}
      </section>
    );
  }

  const textFilters: readonly { readonly key: Exclude<keyof DiagnosticLogFilters, "outcome">; readonly label: string; readonly placeholder: string }[] = [
    { key: "examAttemptId", label: "Exam attempt ID", placeholder: "attempt-123" }, { key: "correlationId", label: "Correlation ID", placeholder: "corr-123" }, { key: "candidateEmail", label: "Candidate email", placeholder: "candidate@helioscx.demo" }, { key: "examId", label: "Exam ID", placeholder: "exam-123" }, { key: "externalId", label: "CloudShare / external ID", placeholder: "env-123" }, { key: "operation", label: "Operation", placeholder: "exam_attempt.resume" }, { key: "source", label: "Source", placeholder: "runtime" }, { key: "integrationSurface", label: "Integration surface", placeholder: "cloudshare.v4.environment" }, { key: "from", label: "From (UTC ISO)", placeholder: "2026-06-21T10:00:00.000Z" }, { key: "to", label: "To (UTC ISO)", placeholder: "2026-06-21T11:00:00.000Z" },
  ];
  const threadFilters = [textFilters[0], { key: "subjectId", label: "Subject ID", placeholder: "sales-trial-enrollment-id or sales-trial-offering-id" }, ...textFilters.slice(1, 5)] as const;
  const eventFilters = textFilters.slice(5);
  const visibleEventFilters = eventFilters.filter((filter) => !props.lockedDiagnosticFilters?.[filter.key]);
  const renderTextFilter = (filter: typeof textFilters[number]) => <label key={filter.key} style={{ display: "grid", gap: "0.35rem" }}><span>{filter.label}</span><input {...extensionHydrationProps} value={diagnosticFilters[filter.key] ?? ""} onChange={(event) => setDiagnosticFilters((current) => ({ ...current, [filter.key]: event.target.value }))} placeholder={filter.placeholder} /></label>;

  return (
    <section>
      {error ? <SupportError message={error} onDismiss={() => setError(null)} /> : null}
      <p style={{ color: colors.textSecondary, marginTop: 0 }}>The correlated diagnostic log: what the portal did, in what order, and how to trace it. Entries are append-only and scoped to your Customer. This is the primary support workflow. Session Monitoring remains the current-state queue view and should link into this tab for forensic investigation. Timestamps are ISO 8601 in UTC. Credential-bearing request headers are masked, safe operational headers remain visible, and protected request/query and provider-response bodies are retained verbatim for authorized admins.</p>
      {props.lockedDiagnosticFilters?.source === "sales-records" ? <div style={{ marginBottom: "0.75rem", padding: "0.65rem 0.8rem", border: "1px solid #b9ded7", borderRadius: "8px", background: "#eef8f6", color: "#174f4a" }}>This view is limited to local Sales record diagnostics.</div> : null}
      <div style={{ border: "1px solid #dfe3eb", borderRadius: "8px", background: "#f8fafc", padding: "1rem", marginBottom: "1rem" }}>
        <div style={{ marginBottom: "0.9rem" }}><h2 style={{ margin: 0, fontSize: "1rem" }}>Investigative filters</h2><p style={{ color: colors.textSecondary, margin: "0.35rem 0 0" }}>Follow an exam attempt, correlation thread, or CloudShare event without changing the underlying diagnostic filtering rules.</p></div>
        <div style={{ display: "grid", gap: "0.9rem" }}>
          <fieldset style={{ margin: 0, border: "1px solid #d7dce4", borderRadius: "8px", padding: "0.8rem", minWidth: 0, background: "#fff" }}><legend style={{ padding: "0 0.35rem", fontWeight: 600 }}>Investigation thread</legend><div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", alignItems: "end" }}>{threadFilters.map(renderTextFilter)}</div></fieldset>
          <fieldset style={{ margin: 0, border: "1px solid #d7dce4", borderRadius: "8px", padding: "0.8rem", minWidth: 0, background: "#fff" }}><legend style={{ padding: "0 0.35rem", fontWeight: 600 }}>Event details</legend><div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", alignItems: "end" }}>{visibleEventFilters.slice(0, 1).map(renderTextFilter)}<label style={{ display: "grid", gap: "0.35rem" }}><span>Outcome</span><select {...extensionHydrationProps} value={diagnosticFilters.outcome ?? ""} onChange={(event) => setDiagnosticFilters((current) => ({ ...current, outcome: (event.target.value || undefined) as DiagnosticLogFilters["outcome"] }))}><option value="">All</option><option value="success">Success</option><option value="failure">Failure</option></select></label>{visibleEventFilters.slice(1).map(renderTextFilter)}</div></fieldset>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.9rem" }}><button {...extensionHydrationProps} onClick={applyDiagnosticFilters} disabled={loading} style={{ padding: "0.4rem 1rem" }}>{loading ? "Loading..." : "Apply Filters"}</button><button {...extensionHydrationProps} onClick={clearDiagnosticFilters} disabled={loading} style={{ padding: "0.4rem 1rem" }}>Clear Filters</button><button {...extensionHydrationProps} onClick={() => void loadDiagnostics()} disabled={loading} style={{ padding: "0.4rem 1rem" }}>Refresh Page</button></div>
      </div>
      {diagnosticPage ? <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.75rem" }}><div style={{ color: colors.textSecondary }}>Showing {diagnosticPage.returned} entries starting at row {diagnosticPage.offset + 1}.</div><div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}><button {...extensionHydrationProps} onClick={() => void loadDiagnostics(Math.max(diagnosticPage.offset - DIAGNOSTIC_PAGE_LIMIT, 0))} disabled={loading || diagnosticPage.offset === 0} style={{ padding: "0.4rem 1rem" }}>Previous</button><button {...extensionHydrationProps} onClick={() => diagnosticPage.nextOffset !== null && void loadDiagnostics(diagnosticPage.nextOffset)} disabled={loading || !diagnosticPage.hasMore} style={{ padding: "0.4rem 1rem" }}>Next</button></div></div> : null}
      {diagnosticFilters.examAttemptId ? <DiagnosticFilterBanner label="exam attempt ID" value={diagnosticFilters.examAttemptId} /> : null}
      {!diagnosticFilters.examAttemptId && diagnosticFilters.correlationId ? <DiagnosticFilterBanner label="correlation ID" value={diagnosticFilters.correlationId} /> : null}
      {diagnosticFilters.subjectId ? <DiagnosticFilterBanner label="subject ID (enrollment or parent Offering)" value={diagnosticFilters.subjectId} /> : null}
      {diagnosticEntries ? <DiagnosticLogTable entries={diagnosticEntries} expandedDiagnosticId={expandedDiagnosticId} onToggleExpanded={(id) => setExpandedDiagnosticId((current) => current === id ? null : id)} onOpenExamAttempt={openExamAttemptDiagnostics} /> : null}
    </section>
  );
}

function mergeLockedDiagnosticFilters(
  filters: DiagnosticLogFilters,
  lockedFilters: DiagnosticLogFilters | undefined,
): DiagnosticLogFilters {
  return normaliseDiagnosticLogFilters({ ...filters, ...lockedFilters });
}

function DiagnosticFilterBanner(props: { readonly label: string; readonly value: string }) {
  return <div style={{ marginBottom: "0.75rem", padding: "0.65rem 0.8rem", border: "1px solid #dbe4ff", borderRadius: "8px", background: "#f5f8ff", color: "#123" }}>Filtered to {props.label} <span style={{ fontFamily: "monospace" }}>{props.value}</span>.</div>;
}

function SupportError(props: { readonly message: string; readonly onDismiss: () => void }) {
  return (
    <div role="alert" style={{ ...alertPanelStyle.danger, display: "grid", gap: "0.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start" }}>
        <p style={{ margin: 0 }}>{props.message}</p>
        <button type="button" onClick={props.onDismiss} style={{ padding: "0.25rem 0.55rem" }}>Dismiss</button>
      </div>
    </div>
  );
}
