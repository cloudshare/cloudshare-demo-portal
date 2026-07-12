"use client";

import React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ADMIN_TABS,
  buildAdminNavigationHref,
  createCorrelationDiagnosticsNavigationIntent,
  createSupportDiagnosticsNavigationIntent,
  getAdminTabLabel,
  getAdminSupportViewLabel,
  shouldClearAdminBannerOnTabChange,
  type AdminExamView,
  type AdminNavigationIntent,
  type AdminSupportView,
  type AdminTab,
  type DiagnosticLogFilters,
} from "./admin-shell-route";
import {
  ADMIN_SESSION_EXPIRED_MESSAGE,
  createAdminAuthenticatedRequest,
  isAdminSessionExpiredError,
} from "./admin-authenticated-request";
import { CloudShareConnectionFeature } from "./admin-cloudshare-connection";
import { AdminCandidateRosterFeature } from "./admin-candidate-roster";
import { AdminSupportFeature } from "./admin-support";
import { AdminSessionMonitoringFeature } from "./admin-session-monitoring";
import {
  AdminExamCatalogAuthoringFeature,
  ExamCatalogLoadingOverlay,
  isCohortSessionAuthoringAvailable,
  type ExamRecord as CatalogExamRecord,
} from "./admin-exam-catalog-authoring";
import {
  CohortSessionDraftControls as FeatureCohortSessionDraftControls,
  CohortSessionDraftOnlyNotice as FeatureCohortSessionDraftOnlyNotice,
  CohortSessionMonitoringList as FeatureCohortSessionMonitoringList,
  CohortSessionWorkspacePanel as FeatureCohortSessionWorkspacePanel,
  formatExamDeliveryAvailability as formatFeatureExamDeliveryAvailability,
  normalizeAdminLocalDateTime,
  type CohortExamSessionFormState,
  type CohortExamSessionRecord,
} from "./admin-cohort-exam-sessions";

export {
  COHORT_SESSION_DRAFT_ONLY_COPY,
  CohortSessionAuthoringPanel,
  CohortSessionDraftOnlyNotice,
  CohortSessionMonitoringList,
  CohortSessionWorkspacePanel,
  formatCohortSessionDateTime,
  normalizeAdminLocalDateTime,
} from "./admin-cohort-exam-sessions";
import { startPortalSessionWatchdog } from "./session-expiry";
import { pageShellStyle } from "./page-shell";
import { cardStyle, mutedPanelStyle, alertPanelStyle } from "./card-styles";
import {
  accountLogoutButtonStyle,
  disabledButtonStyle,
  secondaryButtonStyle,
} from "./button-styles";
import { colors } from "./design-tokens";
import { PortalPageHeader } from "./portal-page-header";

const extensionHydrationProps = {
  suppressHydrationWarning: true,
} as const;

interface AdminConsoleProps {
  readonly email: string;
  readonly initialTab?: AdminTab;
  readonly initialExamView?: AdminExamView;
  readonly initialExamId?: string;
  readonly initialCohortSessionId?: string;
  readonly initialSupportView?: AdminSupportView;
  readonly initialDiagnosticFilters?: DiagnosticLogFilters;
}

interface AdminErrorState {
  readonly message: string;
  readonly correlationId?: string | null;
}

interface ExamRecord extends CatalogExamRecord {}

function CorrelationDiagnosticsLink(props: {
  readonly correlationId: string;
  readonly getNavigationHref?: (intent: AdminNavigationIntent) => string;
  readonly onNavigate?: (intent: AdminNavigationIntent) => void;
  readonly children?: React.ReactNode;
}) {
  const navigation = createCorrelationDiagnosticsNavigationIntent(props.correlationId);

  return (
    <a
      href={props.getNavigationHref?.(navigation)}
      onClick={(event) => {
        if (!props.onNavigate) return;
        event.preventDefault();
        props.onNavigate(navigation);
      }}
      style={{ color: colors.info, fontFamily: "monospace", fontWeight: 700, overflowWrap: "anywhere" }}
    >
      {props.children ?? props.correlationId}
    </a>
  );
}

const adminTabNavStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(10.5rem, 1fr))",
  gap: "0.5rem",
  marginBottom: "1rem",
  borderBottom: `1px solid ${colors.border}`,
  paddingBottom: "0.5rem",
  alignItems: "stretch",
};

const adminTabButtonStyle: React.CSSProperties = {
  padding: "0.6rem 0.9rem",
  border: "1px solid",
  borderRadius: "8px",
  width: "100%",
  minHeight: "2.75rem",
  textAlign: "center",
};

const examCatalogBusyShellStyle: React.CSSProperties = {
  position: "relative",
  overflow: "hidden",
};

function getLogoutButtonStyle(disabled: boolean): React.CSSProperties {
  return disabled
    ? {
        ...accountLogoutButtonStyle,
        ...disabledButtonStyle,
      }
    : accountLogoutButtonStyle;
}
const examWorkspaceBreadcrumbNavStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.45rem",
  margin: 0,
  padding: 0,
  listStyle: "none",
  alignItems: "center",
};

const examWorkspaceBreadcrumbButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  padding: "0.4rem 0.7rem",
  fontSize: "0.85rem",
  background: colors.surfaceSubtle,
  borderColor: colors.border,
};

const examWorkspaceBreadcrumbCurrentStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "0.4rem 0.7rem",
  borderRadius: "999px",
  border: `1px solid ${colors.border}`,
  background: colors.surface,
  color: colors.textPrimary,
  fontSize: "0.85rem",
  fontWeight: 600,
};

export function ExamWorkspaceBreadcrumbs(props: {
  readonly examView: AdminExamView;
  readonly focusedExamTitle: string | null;
  readonly focusedSessionName?: string | null;
  readonly onNavigateToCatalog: () => void;
  readonly onNavigateToSessions?: () => void;
}) {
  const items: Array<{ key: string; label: string; current: boolean; onClick?: () => void }> = [
    {
      key: "catalog",
      label: "Catalog overview",
      current: props.examView === "catalog",
      onClick: props.examView === "catalog" ? undefined : props.onNavigateToCatalog,
    },
  ];

  if (props.examView === "edit" || props.examView === "create") {
    items.push({
      key: props.examView,
      label: props.examView === "edit" ? "Edit Exam" : "Create Exam",
      current: true,
    });
  }

  if ((props.examView === "sessions" || props.examView === "session") && props.focusedExamTitle) {
    items.push({
      key: "sessions",
      label: `Cohort Sessions: ${props.focusedExamTitle}`,
      current: props.examView === "sessions",
      onClick: props.examView === "session" ? props.onNavigateToSessions : undefined,
    });
  }

  if (props.examView === "session" && props.focusedSessionName) {
    items.push({
      key: "session",
      label: props.focusedSessionName,
      current: true,
    });
  }

  return (
    <nav aria-label="Exam workspace">
      <ol style={examWorkspaceBreadcrumbNavStyle}>
        {items.map((item, index) => (
          <React.Fragment key={item.key}>
            {index > 0 ? (
              <li aria-hidden="true" style={{ color: colors.textMuted }}>
                /
              </li>
            ) : null}
            <li>
              {item.current ? (
                <span aria-current="page" style={examWorkspaceBreadcrumbCurrentStyle}>
                  {item.label}
                </span>
              ) : (
                <button type="button" onClick={item.onClick} style={examWorkspaceBreadcrumbButtonStyle}>
                  {item.label}
                </button>
              )}
            </li>
          </React.Fragment>
        ))}
      </ol>
    </nav>
  );
}

export function AdminConsole({
  email,
  initialTab = "exams",
  initialExamView = "catalog",
  initialExamId,
  initialCohortSessionId,
  initialSupportView = "monitoring",
  initialDiagnosticFilters = {},
}: AdminConsoleProps) {
  const router = useRouter();
  const [tab, setTab] = useState<AdminTab>(initialTab);
  const [examView, setExamView] = useState<AdminExamView>(initialExamView);
  const [focusedExamId, setFocusedExamId] = useState<string | null>(initialExamId ?? null);
  const [focusedCohortSessionId, setFocusedCohortSessionId] = useState<string | null>(initialCohortSessionId ?? null);
  const [supportView, setSupportView] = useState<AdminSupportView>(initialSupportView);
  const [examCatalog, setExamCatalog] = useState<ExamRecord[]>([]);
  const [archivedExamCatalog, setArchivedExamCatalog] = useState<ExamRecord[]>([]);
  const [cohortSessionsByExamId, setCohortSessionsByExamId] = useState<Record<string, CohortExamSessionRecord[]>>({});
  const cohortSessionCacheRef = useRef<Record<string, CohortExamSessionRecord[]>>({});
  const cohortSessionLoadsRef = useRef(new Map<string, Promise<void>>());
  const [cohortSessionFormsByExamId, setCohortSessionFormsByExamId] = useState<Record<string, CohortExamSessionFormState>>({});
  const [selectedCohortSession, setSelectedCohortSession] = useState<CohortExamSessionRecord | null>(null);
  const [examMessage, setExamMessage] = useState<string | null>(null);
  const examCatalogLoadingCountRef = useRef(0);
  const [diagnosticFilters, setDiagnosticFilters] = useState<DiagnosticLogFilters>(initialDiagnosticFilters);
  const [loading, setLoading] = useState(false);
  const [examCatalogLoading, setExamCatalogLoading] = useState(false);
  const [errorState, setErrorState] = useState<AdminErrorState | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const error = errorState?.message ?? null;
  const allExamCatalog = [...examCatalog, ...archivedExamCatalog];

  function setError(message: string | null) {
    setErrorState(message === null ? null : { message, correlationId: null });
  }

  function setErrorWithCorrelation(message: string, correlationId?: string | null) {
    setErrorState({ message, correlationId: correlationId ?? null });
  }

  useEffect(() => {
    if (tab === "exams" && (examView === "sessions" || examView === "session")) {
      void loadExamCatalog();
    }
    if (tab === "support" && supportView === "monitoring") {
      void loadExamCatalog(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, examView, supportView]);

  useEffect(() => {
    if (tab !== "exams" || (examView !== "sessions" && examView !== "session") || !focusedExamId) {
      return;
    }
    void loadCohortExamSessions(focusedExamId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, examView, focusedExamId]);

  function beginExamCatalogLoading() {
    examCatalogLoadingCountRef.current += 1;
    setExamCatalogLoading(true);
  }

  function endExamCatalogLoading() {
    examCatalogLoadingCountRef.current = Math.max(0, examCatalogLoadingCountRef.current - 1);
    setExamCatalogLoading(examCatalogLoadingCountRef.current > 0);
  }

  const handleAdminSessionExpired = useCallback(() => {
    setSessionExpired(true);
    setError(ADMIN_SESSION_EXPIRED_MESSAGE);
    router.replace("/login");
    router.refresh();
  }, [router]);

  const fetchAdmin = useMemo(
    () => createAdminAuthenticatedRequest({ fetchImpl: fetch, onSessionExpired: handleAdminSessionExpired }),
    [handleAdminSessionExpired],
  );

  const getNavigationHref = useCallback(
    (intent: AdminNavigationIntent) => buildAdminNavigationHref(intent),
    [],
  );

  useEffect(() => {
    if (sessionExpired) {
      return;
    }

    const watchdog = startPortalSessionWatchdog({
      fetchImpl: fetch,
      onExpired: handleAdminSessionExpired,
    });
    void watchdog.checkNow();

    return () => watchdog.stop();
  }, [handleAdminSessionExpired, sessionExpired]);

  function navigateAdmin(next: AdminNavigationIntent) {
    const nextDiagnosticFilters = next.diagnosticFilters ?? diagnosticFilters;
    const nextExamView = next.examView ?? "catalog";
    const nextSupportView = next.supportView ?? "monitoring";
    router.push(buildAdminNavigationHref({
      tab: next.tab,
      examView: nextExamView,
      examId: next.examId,
      cohortSessionId: next.cohortSessionId,
      supportView: nextSupportView,
      diagnosticFilters: nextDiagnosticFilters,
    }));
    setTab(next.tab);
    setExamView(nextExamView);
    setFocusedExamId(next.examId ?? null);
    setFocusedCohortSessionId(next.cohortSessionId ?? null);
    setSupportView(nextSupportView);
    setDiagnosticFilters(nextDiagnosticFilters);
  }

  function navigateToExamCatalog() {
    setSelectedCohortSession(null);
    navigateAdmin({ tab: "exams", examView: "catalog" });
  }
  function navigateToExamSessions(examId: string) {
    setSelectedCohortSession(null);
    navigateAdmin({ tab: "exams", examView: "sessions", examId });
    void loadCohortExamSessions(examId);
  }

  async function loadExamCatalog(loadCohortSessions = true) {
    beginExamCatalogLoading();
    try {
      const response = await fetchAdmin("/api/admin/exams");
      const data = (await response.json()) as {
        activeExams?: ExamRecord[];
        archivedExams?: ExamRecord[];
        error?: string;
      };
      if (!response.ok) {
        setError(data.error ?? "Failed to load exam catalog");
        return;
      }
      const nextExams = data.activeExams ?? [];
      const nextArchivedExams = data.archivedExams ?? [];
      setExamCatalog(nextExams);
      setArchivedExamCatalog(nextArchivedExams);
      await Promise.all(
        nextExams
          .filter((exam) => loadCohortSessions || !cohortSessionCacheRef.current[exam.id])
          .map((exam) => loadCohortExamSessions(exam.id)),
      );
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setError("Failed to load exam catalog");
    } finally {
      endExamCatalogLoading();
    }
  }

  async function loadCohortExamSessions(examId: string) {
    const inFlight = cohortSessionLoadsRef.current.get(examId);
    if (inFlight) return inFlight;

    const request = (async () => {
      try {
        const response = await fetchAdmin(`/api/admin/exams/${encodeURIComponent(examId)}/cohort-sessions`);
        const data = (await response.json()) as { sessions?: CohortExamSessionRecord[]; error?: string };
        if (!response.ok) {
          setError(data.error ?? "Failed to load Cohort Exam Sessions");
          return;
        }
        const sessions = data.sessions ?? [];
        cohortSessionCacheRef.current = { ...cohortSessionCacheRef.current, [examId]: sessions };
        setCohortSessionsByExamId((current) => ({ ...current, [examId]: sessions }));
      } catch (caughtError) {
        if (!isAdminSessionExpiredError(caughtError)) setError("Failed to load Cohort Exam Sessions");
      } finally {
        cohortSessionLoadsRef.current.delete(examId);
      }
    })();
    cohortSessionLoadsRef.current.set(examId, request);
    return request;
  }

  function getCohortSessionForm(examId: string): CohortExamSessionFormState {
    return cohortSessionFormsByExamId[examId] ?? {
      name: "",
      admissionStartsAt: "",
      admissionEndsAt: "",
      capacity: "",
    };
  }

  function updateCohortSessionForm(examId: string, patch: Partial<CohortExamSessionFormState>) {
    setCohortSessionFormsByExamId((current) => ({
      ...current,
      [examId]: {
        ...(current[examId] ?? { name: "", admissionStartsAt: "", admissionEndsAt: "", capacity: "" }),
        ...patch,
      },
    }));
  }

  async function createDraftCohortSession(examId: string) {
    const form = getCohortSessionForm(examId);
    const admissionStartsAt = normalizeAdminLocalDateTime(form.admissionStartsAt);
    const admissionEndsAt = normalizeAdminLocalDateTime(form.admissionEndsAt);
    setLoading(true);
    setError(null);
    setExamMessage(null);
    if (!admissionStartsAt) {
      setError("Choose a valid admission open date and time.");
      setLoading(false);
      return;
    }
    if (form.admissionEndsAt.trim() && !admissionEndsAt) {
      setError("Choose a valid admission close date and time.");
      setLoading(false);
      return;
    }
    try {
      const response = await fetchAdmin(`/api/admin/exams/${encodeURIComponent(examId)}/cohort-sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          admissionStartsAt,
          admissionEndsAt,
          capacity: form.capacity ? Number(form.capacity) : null,
        }),
      });
      const data = (await response.json()) as CohortExamSessionRecord & { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Failed to create draft Cohort Exam Session");
        return;
      }
      setSelectedCohortSession(data);
      setExamMessage("Draft Cohort Exam Session created.");
      setCohortSessionFormsByExamId((current) => ({
        ...current,
        [examId]: { name: "", admissionStartsAt: "", admissionEndsAt: "", capacity: "" },
      }));
      await loadCohortExamSessions(examId);
      navigateAdmin({
        tab: "exams",
        examView: "session",
        examId,
        cohortSessionId: data.session.id,
      });
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setError("Failed to create draft Cohort Exam Session");
    } finally {
      setLoading(false);
    }
  }

  async function publishCohortSession(examId: string, sessionId: string) {
    setLoading(true);
    setError(null);
    setExamMessage(null);
    try {
      const response = await fetchAdmin(
        `/api/admin/exams/${encodeURIComponent(examId)}/cohort-sessions/${encodeURIComponent(sessionId)}/publish`,
        { method: "POST" },
      );
      const data = (await response.json()) as CohortExamSessionRecord & { error?: string; correlationId?: string };
      if (!response.ok) {
        setErrorWithCorrelation(data.error ?? "Failed to publish Cohort Exam Session", data.correlationId);
        await loadCohortExamSessions(examId);
        return;
      }
      setSelectedCohortSession(data);
      setExamMessage("Cohort Exam Session published to CloudShare.");
      await loadCohortExamSessions(examId);
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setError("Failed to publish Cohort Exam Session");
    } finally {
      setLoading(false);
    }
  }

  async function closeCohortSessionAdmission(examId: string, sessionId: string) {
    setLoading(true);
    setError(null);
    setExamMessage(null);
    try {
      const response = await fetchAdmin(
        `/api/admin/exams/${encodeURIComponent(examId)}/cohort-sessions/${encodeURIComponent(sessionId)}/close-admission`,
        { method: "POST" },
      );
      const data = (await response.json()) as { session?: CohortExamSessionRecord["session"]; error?: string };
      if (!response.ok) {
        setError(data.error ?? "Failed to close Cohort Exam Session admission");
        return;
      }
      setExamMessage("Cohort Exam Session admission closed.");
      await loadCohortExamSessions(examId);
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setError("Failed to close Cohort Exam Session admission");
    } finally {
      setLoading(false);
    }
  }

  async function retireCohortSession(examId: string, sessionId: string, confirmInterrupt = false) {
    setLoading(true);
    setError(null);
    setExamMessage(null);
    try {
      const response = await fetchAdmin(
        `/api/admin/exams/${encodeURIComponent(examId)}/cohort-sessions/${encodeURIComponent(sessionId)}/retire`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(confirmInterrupt ? { confirmInterrupt: true } : {}),
        },
      );
      const data = (await response.json()) as {
        error?: string;
        code?: string;
        correlationId?: string;
        warning?: {
          activeParticipantCount?: number;
          nonTerminalEnvironmentCount?: number;
        };
      };
      if (response.status === 409 && data.code === "confirmation_required" && !confirmInterrupt) {
        const proceed = window.confirm(
          `Retire this Cohort Exam Session? ` +
            `${data.warning?.activeParticipantCount ?? 0} active participant(s) and ` +
            `${data.warning?.nonTerminalEnvironmentCount ?? 0} non-terminal environment(s) may be interrupted.`,
        );
        if (proceed) {
          await retireCohortSession(examId, sessionId, true);
        }
        return;
      }
      if (!response.ok) {
        setErrorWithCorrelation(data.error ?? "Failed to retire Cohort Exam Session", data.correlationId);
        return;
      }
      setExamMessage("Cohort Exam Session retired.");
      await loadCohortExamSessions(examId);
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setError("Failed to retire Cohort Exam Session");
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    setLoading(true);
    setError(null);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  const focusedExam = focusedExamId ? (allExamCatalog.find((exam) => exam.id === focusedExamId) ?? null) : null;
  const focusedExamSessions = focusedExamId ? (cohortSessionsByExamId[focusedExamId] ?? []) : [];
  const focusedCohortSession =
    (focusedCohortSessionId
      ? focusedExamSessions.find((session) => session.session.id === focusedCohortSessionId)
      : null) ??
    (selectedCohortSession?.session.id === focusedCohortSessionId ? selectedCohortSession : null);
  const monitoredCohortSessions = allExamCatalog.flatMap((exam) =>
    (cohortSessionsByExamId[exam.id] ?? []).map((session) => ({ exam, session })),
  );
  if (sessionExpired) {
    return (
      <main style={pageShellStyle}>
        <h1 style={{ marginBottom: "0.5rem" }}>Admin session expired</h1>
        <p style={{ color: "#555" }}>{ADMIN_SESSION_EXPIRED_MESSAGE}</p>
        <button onClick={() => router.replace("/login")} style={{ padding: "0.55rem 0.9rem" }}>
          Go to login
        </button>
      </main>
    );
  }

  return (
    <main
      style={{
        ...pageShellStyle,
        minHeight: "100vh",
        scrollbarGutter: "stable",
      }}
    >
      <PortalPageHeader
        eyebrow="Helios Admin Portal"
        title="Certalis Admin Console"
        description="Manage the Helios CX CloudShare Connection, Exam catalog, Candidate accounts, and active exam attempt support workflows."
        email={email}
        actions={
          <button {...extensionHydrationProps} onClick={logout} disabled={loading} style={getLogoutButtonStyle(loading)}>
            Log out
          </button>
        }
      />
      <nav
        aria-label="Admin console sections"
        style={adminTabNavStyle}
      >
        {ADMIN_TABS.map((t) => {
          const isActive = tab === t;

          return (
            <button
              {...extensionHydrationProps}
              key={t}
              type="button"
              aria-current={isActive ? "page" : undefined}
              onClick={() => {
                if (shouldClearAdminBannerOnTabChange(tab, t)) {
                  setError(null);
                }
                navigateAdmin({
                  tab: t,
                  examView: t === "exams" ? "catalog" : undefined,
                  supportView: t === "support" ? supportView : undefined,
                });
              }}
              style={{
                ...adminTabButtonStyle,
                background: isActive ? colors.textPrimary : t === "support" ? colors.accentSoft : "#ffffff",
                color: isActive ? "#ffffff" : "#111827",
                borderColor: isActive ? colors.textPrimary : t === "support" ? "#b9ded7" : "#d1d5db",
                cursor: "pointer",
                fontWeight: isActive ? 700 : 600,
                boxShadow: isActive ? "inset 0 -3px 0 #0f6d66" : "none",
              }}
            >
              {getAdminTabLabel(t)}
            </button>
          );
        })}
      </nav>

      {error && (
        <div style={{ ...alertPanelStyle.danger, display: "grid", gap: "0.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start" }}>
            <p style={{ margin: 0 }}>{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
              style={{ padding: "0.25rem 0.55rem" }}
            >
              Dismiss
            </button>
          </div>
          {errorState?.correlationId ? (
            <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
              <p style={{ margin: 0, fontSize: "0.85rem" }}>
                Open <strong>Support Diagnostics</strong> filtered by correlation ID{" "}
                <CorrelationDiagnosticsLink
                  correlationId={errorState.correlationId}
                  getNavigationHref={getNavigationHref}
                  onNavigate={navigateAdmin}
                />
                .
              </p>
            </div>
          ) : null}
        </div>
      )}

      <AdminCandidateRosterFeature
        active={tab === "candidates"}
        fetchAdmin={fetchAdmin}
      />

      <CloudShareConnectionFeature
        active={tab === "configuration"}
        fetchAdmin={fetchAdmin}
        getNavigationHref={getNavigationHref}
        onNavigate={navigateAdmin}
        onBusyChange={setLoading}
      />

      {tab === "exams" && (examView === "catalog" || examView === "create" || examView === "edit") && (
        <AdminExamCatalogAuthoringFeature
          active
          examView={examView}
          focusedExamId={focusedExamId}
          fetchAdmin={fetchAdmin}
          onNavigate={navigateAdmin}
          onCatalogChange={({ activeExams, archivedExams }) => {
            const nextExams = [...activeExams];
            const nextArchivedExams = [...archivedExams];
            setExamCatalog(nextExams);
            setArchivedExamCatalog(nextArchivedExams);
            void Promise.all(nextExams.map((exam) => loadCohortExamSessions(exam.id)));
          }}
          getHasActiveCohortSessions={(examId) =>
            (cohortSessionsByExamId[examId] ?? []).some((session) => session.session.status !== "retired")
          }
        />
      )}

      {tab === "exams" && (examView === "sessions" || examView === "session") && (
        <section
          aria-busy={examCatalogLoading}
          style={{ ...examCatalogBusyShellStyle, display: "grid", gap: "1rem" }}
        >
          {examCatalogLoading ? <ExamCatalogLoadingOverlay /> : null}
          <div style={{ ...mutedPanelStyle, display: "grid", gap: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
              <div>
                <h2 style={{ margin: 0 }}>Exam Catalog</h2>
                <p style={{ margin: "0.25rem 0 0", color: colors.textSecondary }}>
                  Overview of Exams and delivery options for Helios CX.
                </p>
              </div>
            </div>
            <ExamWorkspaceBreadcrumbs
              examView={examView}
              focusedExamTitle={focusedExam?.title ?? null}
              focusedSessionName={focusedCohortSession?.session.name ?? null}
              onNavigateToCatalog={navigateToExamCatalog}
              onNavigateToSessions={focusedExam ? () => navigateToExamSessions(focusedExam.id) : undefined}
            />
          </div>
          {examView === "sessions" && focusedExam && (
            <div style={{ ...cardStyle, display: "grid", gap: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                <div>
                  <h3 style={{ margin: 0 }}>Cohort Exam Sessions</h3>
                  <p style={{ margin: "0.25rem 0 0", color: colors.textSecondary }}>
                    {focusedExam.title} · {formatFeatureExamDeliveryAvailability(focusedExam.deliveryAvailability)}
                  </p>
                  <FeatureCohortSessionDraftOnlyNotice />
                </div>
                <button type="button" onClick={navigateToExamCatalog} style={secondaryButtonStyle}>
                  Back to catalog
                </button>
              </div>
              {isCohortSessionAuthoringAvailable(focusedExam.deliveryAvailability) ? (
                <FeatureCohortSessionDraftControls
                  examId={focusedExam.id}
                  form={getCohortSessionForm(focusedExam.id)}
                  sessions={focusedExamSessions}
                  loading={loading}
                  onChange={(patch) => updateCohortSessionForm(focusedExam.id, patch)}
                  onCreate={() => void createDraftCohortSession(focusedExam.id)}
                  onSelect={(session) => {
                    setSelectedCohortSession(session);
                    navigateAdmin({
                      tab: "exams",
                      examView: "session",
                      examId: focusedExam.id,
                      cohortSessionId: session.session.id,
                    });
                  }}
                />
              ) : (
                <span style={{ color: colors.textSecondary }}>
                  Cohort Exam Sessions are unavailable for individual-only Exams.
                </span>
              )}
            </div>
          )}

          {examView === "session" && focusedExam && focusedCohortSession && (
          <FeatureCohortSessionWorkspacePanel
              examTitle={focusedExam.title}
              session={focusedCohortSession}
              loading={loading}
              onBack={() => navigateToExamSessions(focusedExam.id)}
              onPublish={() => void publishCohortSession(focusedExam.id, focusedCohortSession.session.id)}
              onCloseAdmission={() =>
                void closeCohortSessionAdmission(focusedExam.id, focusedCohortSession.session.id)
              }
              onRetire={() => void retireCohortSession(focusedExam.id, focusedCohortSession.session.id)}
              getNavigationHref={getNavigationHref}
              onNavigate={navigateAdmin}
              onOpenMonitoring={() =>
                navigateAdmin({
                  tab: "support",
                  supportView: "monitoring",
                  examId: focusedExam.id,
                  cohortSessionId: focusedCohortSession.session.id,
                })
              }
            />
          )}

          {examView === "session" && focusedExam && focusedCohortSessionId && !focusedCohortSession && (
            <div style={{ ...alertPanelStyle.warning, display: "grid", gap: "0.5rem" }}>
              <p style={{ margin: 0 }}>Cohort Exam Session detail is not loaded yet.</p>
              <button type="button" onClick={() => void loadCohortExamSessions(focusedExam.id)} style={secondaryButtonStyle}>
                Refresh Cohort Sessions
              </button>
            </div>
          )}
        </section>
      )}

      {tab === "support" && (
        <section style={{ display: "grid", gap: "1rem" }}>
          <div style={{ ...mutedPanelStyle, display: "grid", gap: "0.75rem" }}>
            <strong>Support workflows</strong>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {(["monitoring", "diagnostics", "audit"] as const).map((view) => (
                <button
                  {...extensionHydrationProps}
                  key={view}
                  type="button"
                  aria-current={supportView === view ? "page" : undefined}
                  onClick={() => navigateAdmin({ tab: "support", supportView: view })}
                  style={{
                    padding: "0.5rem 0.8rem",
                    border: `1px solid ${supportView === view ? colors.textPrimary : colors.border}`,
                    borderRadius: "8px",
                    background: supportView === view ? colors.textPrimary : "#ffffff",
                    color: supportView === view ? "#ffffff" : colors.textPrimary,
                    fontWeight: 600,
                  }}
                >
                  {getAdminSupportViewLabel(view)}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      <AdminSupportFeature
        active={tab === "support"}
        view={supportView}
        diagnosticFilters={diagnosticFilters}
        fetchAdmin={fetchAdmin}
        onNavigate={navigateAdmin}
      />

      <AdminSessionMonitoringFeature
        active={tab === "support" && supportView === "monitoring"}
        fetchAdmin={fetchAdmin}
        onNavigate={navigateAdmin}
        focusedExamId={focusedExamId}
        focusedCohortSessionId={focusedCohortSessionId}
        hasFocusedCohortSession={focusedCohortSession !== null}
        onEnsureCohortSessions={(examId) => {
          if (!cohortSessionCacheRef.current[examId]) void loadCohortExamSessions(examId);
        }}
        renderFocusedCohort={({ detail, lastCheckedAt, onRefresh }) =>
          focusedExam && focusedCohortSession ? (
            <FeatureCohortSessionWorkspacePanel
              mode="monitoring"
              examTitle={focusedExam.title}
              session={focusedCohortSession}
              detail={detail}
              loading={loading}
              lastCheckedAt={lastCheckedAt}
              onRefresh={onRefresh}
              onBack={() => navigateAdmin({ tab: "support", supportView: "monitoring" })}
              onPublish={() => undefined}
              getNavigationHref={getNavigationHref}
              onNavigate={navigateAdmin}
            />
          ) : undefined
        }
        cohortContent={
          <FeatureCohortSessionMonitoringList
            sessions={monitoredCohortSessions}
            onOpen={(examId, cohortSessionId) =>
              navigateAdmin({ tab: "support", supportView: "monitoring", examId, cohortSessionId })
            }
          />
        }
      />

    </main>
  );
}

