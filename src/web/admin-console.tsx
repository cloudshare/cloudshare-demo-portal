"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ADMIN_TABS,
  buildAdminNavigationHref,
  getAdminSupportViewLabel,
  getAdminTabLabel,
  type AdminExamView,
  type AdminNavigationIntent,
  type AdminSupportView,
  type AdminTab,
  type DiagnosticLogFilters,
} from "./admin-shell-route";
import { ADMIN_SESSION_EXPIRED_MESSAGE, createAdminAuthenticatedRequest } from "./admin-authenticated-request";
import { CloudShareConnectionFeature } from "./admin-cloudshare-connection";
import { AdminCandidateRosterFeature } from "./admin-candidate-roster";
import { AdminSupportFeature } from "./admin-support";
import { AdminExamWorkspaceFeature } from "./admin-exam-workspace-feature";
import { startPortalSessionWatchdog } from "./session-expiry";
import { pageShellStyle } from "./page-shell";
import { mutedPanelStyle } from "./card-styles";
import { accountLogoutButtonStyle, disabledButtonStyle } from "./button-styles";
import { colors } from "./design-tokens";
import { PortalPageHeader } from "./portal-page-header";

const extensionHydrationProps = { suppressHydrationWarning: true } as const;

interface AdminConsoleProps {
  readonly email: string;
  readonly initialTab?: AdminTab;
  readonly initialExamView?: AdminExamView;
  readonly initialExamId?: string;
  readonly initialCohortSessionId?: string;
  readonly initialSupportView?: AdminSupportView;
  readonly initialDiagnosticFilters?: DiagnosticLogFilters;
}

const tabNavStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(10.5rem, 1fr))", gap: "0.5rem",
  marginBottom: "1rem", borderBottom: `1px solid ${colors.border}`, paddingBottom: "0.5rem", alignItems: "stretch",
};

const tabButtonStyle: React.CSSProperties = { padding: "0.6rem 0.9rem", border: "1px solid", borderRadius: "8px", width: "100%", minHeight: "2.75rem", textAlign: "center" };

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
  const [diagnosticFilters, setDiagnosticFilters] = useState<DiagnosticLogFilters>(initialDiagnosticFilters);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleAdminSessionExpired = useCallback(() => {
    setSessionExpired(true);
    router.replace("/login");
    router.refresh();
  }, [router]);
  const browserFetch = useCallback<typeof fetch>((input, init) => window.fetch(input, init), []);
  const fetchAdmin = useMemo(() => createAdminAuthenticatedRequest({ fetchImpl: browserFetch, onSessionExpired: handleAdminSessionExpired }), [browserFetch, handleAdminSessionExpired]);
  const getNavigationHref = useCallback((intent: AdminNavigationIntent) => buildAdminNavigationHref(intent), []);

  useEffect(() => {
    if (sessionExpired) return;
    const watchdog = startPortalSessionWatchdog({ fetchImpl: browserFetch, onExpired: handleAdminSessionExpired });
    void watchdog.checkNow();
    return () => watchdog.stop();
  }, [browserFetch, handleAdminSessionExpired, sessionExpired]);

  function navigateAdmin(next: AdminNavigationIntent) {
    const nextDiagnosticFilters = next.diagnosticFilters ?? diagnosticFilters;
    const nextExamView = next.examView ?? "catalog";
    const nextSupportView = next.supportView ?? "monitoring";
    router.push(buildAdminNavigationHref({ tab: next.tab, examView: nextExamView, examId: next.examId, cohortSessionId: next.cohortSessionId, supportView: nextSupportView, diagnosticFilters: nextDiagnosticFilters }));
    setTab(next.tab); setExamView(nextExamView); setFocusedExamId(next.examId ?? null); setFocusedCohortSessionId(next.cohortSessionId ?? null); setSupportView(nextSupportView); setDiagnosticFilters(nextDiagnosticFilters);
  }

  async function logout() {
    setLoggingOut(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); }
    finally { router.push("/login"); router.refresh(); }
  }

  if (sessionExpired) return <main style={pageShellStyle}><h1 style={{ marginBottom: "0.5rem" }}>Admin session expired</h1><p style={{ color: "#555" }}>{ADMIN_SESSION_EXPIRED_MESSAGE}</p><button onClick={() => router.replace("/login")} style={{ padding: "0.55rem 0.9rem" }}>Go to login</button></main>;

  return <main style={{ ...pageShellStyle, minHeight: "100vh", scrollbarGutter: "stable" }}>
    <PortalPageHeader eyebrow="Helios Admin Portal" title="Certalis Admin Console" description="Manage the Helios CX CloudShare Connection, Exam catalog, Candidate accounts, and active exam attempt support workflows." email={email} actions={<button {...extensionHydrationProps} onClick={logout} disabled={loggingOut} style={loggingOut ? { ...accountLogoutButtonStyle, ...disabledButtonStyle } : accountLogoutButtonStyle}>Log out</button>} />
    <nav aria-label="Admin console sections" style={tabNavStyle}>{ADMIN_TABS.map((item) => {
      const active = tab === item;
      return <button {...extensionHydrationProps} key={item} type="button" aria-current={active ? "page" : undefined} onClick={() => navigateAdmin({ tab: item, examView: item === "exams" ? "catalog" : undefined, supportView: item === "support" ? supportView : undefined })} style={{ ...tabButtonStyle, background: active ? colors.textPrimary : item === "support" ? colors.accentSoft : "#ffffff", color: active ? "#ffffff" : "#111827", borderColor: active ? colors.textPrimary : item === "support" ? "#b9ded7" : "#d1d5db", cursor: "pointer", fontWeight: active ? 700 : 600, boxShadow: active ? "inset 0 -3px 0 #0f6d66" : "none" }}>{getAdminTabLabel(item)}</button>;
    })}</nav>

    <AdminCandidateRosterFeature active={tab === "candidates"} fetchAdmin={fetchAdmin} />
    <CloudShareConnectionFeature active={tab === "configuration"} fetchAdmin={fetchAdmin} getNavigationHref={getNavigationHref} onNavigate={navigateAdmin} />
    <React.Fragment key="support-workflow-navigation">{tab === "support" ? <section style={{ display: "grid", gap: "1rem" }}><div style={{ ...mutedPanelStyle, display: "grid", gap: "0.75rem" }}><strong>Support workflows</strong><div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>{(["monitoring", "diagnostics", "audit"] as const).map((view) => <button {...extensionHydrationProps} key={view} type="button" aria-current={supportView === view ? "page" : undefined} onClick={() => navigateAdmin({ tab: "support", supportView: view })} style={{ padding: "0.5rem 0.8rem", border: `1px solid ${supportView === view ? colors.textPrimary : colors.border}`, borderRadius: "8px", background: supportView === view ? colors.textPrimary : "#ffffff", color: supportView === view ? "#ffffff" : colors.textPrimary, fontWeight: 600 }}>{getAdminSupportViewLabel(view)}</button>)}</div></div></section> : null}</React.Fragment>
    <AdminExamWorkspaceFeature key="exam-workspace" active={tab === "exams" || (tab === "support" && supportView === "monitoring")} examFeatureActive={tab === "exams"} examView={examView} focusedExamId={focusedExamId} focusedCohortSessionId={focusedCohortSessionId} supportMonitoringActive={tab === "support" && supportView === "monitoring"} fetchAdmin={fetchAdmin} onNavigate={navigateAdmin} getNavigationHref={getNavigationHref} />
    <AdminSupportFeature active={tab === "support" && supportView !== "monitoring"} view={supportView} diagnosticFilters={diagnosticFilters} fetchAdmin={fetchAdmin} onNavigate={navigateAdmin} />
  </main>;
}
