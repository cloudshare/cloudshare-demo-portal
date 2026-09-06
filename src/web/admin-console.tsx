"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ADMIN_NAVIGATION_ITEMS,
  ADMIN_SUPPORT_NAVIGATION_ITEMS,
  buildAdminNavigationHref,
  getAdminSupportViewLabel,
  type AdminDeliveryView,
  type AdminExamView,
  type AdminNavigationIntent,
  type AdminSupportView,
  type AdminTab,
  type DiagnosticLogFilters,
} from "./admin-shell-route";
import { createAdminAuthenticatedRequest } from "./admin-authenticated-request";
import { CloudShareConnectionFeature } from "./admin-cloudshare-connection";
import { AdminCandidateRosterFeature } from "./admin-candidate-roster";
import { AdminSupportFeature } from "./admin-support";
import { AdminExamWorkspaceFeature } from "./admin-exam-workspace-feature";
import { startPortalSessionWatchdog } from "./session-expiry";
import { pageShellStyle } from "./page-shell";
import { mutedPanelStyle } from "./card-styles";
import { colors } from "./design-tokens";
import { createPortalSessionExpiryRedirect } from "./portal-session-redirect";
import styles from "./admin-console.module.css";

const extensionHydrationProps = { suppressHydrationWarning: true } as const;

interface AdminConsoleProps {
  readonly email: string;
  readonly initialTab?: AdminTab;
  readonly initialExamView?: AdminExamView;
  readonly initialExamId?: string;
  readonly initialCohortSessionId?: string;
  readonly initialReturnFocusSessionId?: string;
  readonly initialSupportView?: AdminSupportView;
  readonly initialDeliveryView?: AdminDeliveryView | null;
  readonly initialDiagnosticFilters?: DiagnosticLogFilters;
  readonly initialRouteNotice?: string;
}

export function AdminConsole({
  email,
  initialTab = "exams",
  initialExamView = "catalog",
  initialExamId,
  initialCohortSessionId,
  initialReturnFocusSessionId,
  initialSupportView = "monitoring",
  initialDeliveryView = null,
  initialDiagnosticFilters = {},
  initialRouteNotice,
}: AdminConsoleProps) {
  const router = useRouter();
  const [tab, setTab] = useState<AdminTab>(initialTab);
  const [examView, setExamView] = useState<AdminExamView>(initialExamView);
  const [focusedExamId, setFocusedExamId] = useState<string | null>(initialExamId ?? null);
  const [focusedCohortSessionId, setFocusedCohortSessionId] = useState<string | null>(initialCohortSessionId ?? null);
  const [returnFocusSessionId, setReturnFocusSessionId] = useState<string | null>(initialReturnFocusSessionId ?? null);
  const [supportView, setSupportView] = useState<AdminSupportView>(initialSupportView);
  const [supportNavigationOpen, setSupportNavigationOpen] = useState(initialTab === "support");
  const [deliveryView, setDeliveryView] = useState<AdminDeliveryView | null>(initialDeliveryView);
  const [diagnosticFilters, setDiagnosticFilters] = useState<DiagnosticLogFilters>(initialDiagnosticFilters);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const routeFocusRef = useRef<HTMLElement>(null);

  const handleAdminSessionExpired = useMemo(() => createPortalSessionExpiryRedirect({
    currentPath: () => `${window.location.pathname}${window.location.search}`,
    fallbackLoginPath: "/login",
    replace: (path) => {
      setSessionExpired(true);
      router.replace(path);
    },
  }), [router]);
  const browserFetch = useCallback<typeof fetch>((input, init) => window.fetch(input, init), []);
  const fetchAdmin = useMemo(() => createAdminAuthenticatedRequest({ fetchImpl: browserFetch, onSessionExpired: handleAdminSessionExpired }), [browserFetch, handleAdminSessionExpired]);
  const getNavigationHref = useCallback((intent: AdminNavigationIntent) => buildAdminNavigationHref(intent), []);
  const handleReturnFocusResolved = useCallback((restored: boolean) => {
    if (!restored) routeFocusRef.current?.focus();
  }, []);

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
    const currentRouteAcceptsDelivery = (tab === "exams" && examView !== "create" && examView !== "edit")
      || (tab === "support" && supportView === "monitoring");
    const nextRouteAcceptsDelivery = (next.tab === "exams" && nextExamView !== "create" && nextExamView !== "edit")
      || (next.tab === "support" && nextSupportView === "monitoring");
    const nextDeliveryView = next.deliveryView !== undefined
      ? next.deliveryView
      : currentRouteAcceptsDelivery && nextRouteAcceptsDelivery ? deliveryView : null;
    if (tab === "exams" && examView === "sessions" && next.tab === "exams" && nextExamView === "session" && next.returnFocusSessionId) {
      const queueHref = buildAdminNavigationHref({ tab: "exams", examView: "sessions", examId: focusedExamId, returnFocusSessionId: next.returnFocusSessionId, deliveryView });
      window.history.replaceState(window.history.state, "", queueHref);
    }
    if (tab === "support" && supportView === "monitoring" && !focusedCohortSessionId && next.tab === "support" && nextSupportView === "monitoring" && next.cohortSessionId && next.returnFocusSessionId) {
      const queueHref = buildAdminNavigationHref({ tab: "support", supportView: "monitoring", returnFocusSessionId: next.returnFocusSessionId, deliveryView: "cohort" });
      window.history.replaceState(window.history.state, "", queueHref);
    }
    router.push(buildAdminNavigationHref({ tab: next.tab, examView: nextExamView, examId: next.examId, cohortSessionId: next.cohortSessionId, returnFocusSessionId: next.returnFocusSessionId, supportView: nextSupportView, deliveryView: nextDeliveryView, diagnosticFilters: nextDiagnosticFilters }));
    setTab(next.tab); setExamView(nextExamView); setFocusedExamId(next.examId ?? null); setFocusedCohortSessionId(next.cohortSessionId ?? null); setReturnFocusSessionId(next.returnFocusSessionId ?? null); setSupportView(nextSupportView); setDeliveryView(nextDeliveryView); setDiagnosticFilters(nextDiagnosticFilters);
  }

  useEffect(() => {
    if (returnFocusSessionId && ((tab === "exams" && examView === "sessions") || (tab === "support" && supportView === "monitoring" && deliveryView === "cohort" && !focusedCohortSessionId))) return;
    routeFocusRef.current?.focus();
  }, [tab, examView, focusedExamId, focusedCohortSessionId, returnFocusSessionId, supportView, deliveryView]);

  useEffect(() => {
    if (tab === "support") setSupportNavigationOpen(true);
  }, [tab]);

  async function logout() {
    setLoggingOut(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); }
    finally { router.push("/login"); router.refresh(); }
  }

  if (sessionExpired) return <main aria-live="polite" style={pageShellStyle}>Continuing to sign in…</main>;

  return <div className={styles.adminShell}>
    <aside className={styles.adminSidebar} aria-label="Helios Admin workspace navigation">
      <div className={styles.adminBrand}><span className={styles.adminBrandMark} aria-hidden="true">H</span><div><strong>Certalis</strong><small>Helios Certification</small></div></div>
      <nav aria-label="Helios Admin certification navigation" className={styles.adminNavigation}><ul className={styles.adminNavigationList}>{ADMIN_NAVIGATION_ITEMS.map((item) => {
      const deepExamDelivery = tab === "exams" && (examView === "sessions" || examView === "session") ? "cohort" : deliveryView;
      const examItemActive = item.key === "catalog"
        ? (examView === "catalog" && deliveryView === null) || (examView !== "catalog" && deepExamDelivery === null)
        : (item.intent.deliveryView ?? null) === deepExamDelivery;
      const active = item.intent.tab === tab && (item.intent.tab !== "exams" || examItemActive);
      if (item.key === "support") {
        return <li key={item.key}><details open={supportNavigationOpen} onToggle={(event) => setSupportNavigationOpen(event.currentTarget.open)} className={styles.adminNavigationGroup}>
          <summary className={styles.adminNavigationGroupSummary} data-active={tab === "support" ? "true" : undefined} aria-current={tab === "support" && !supportNavigationOpen ? "page" : undefined}>{item.label}</summary>
          <ul className={styles.adminNavigationSubmenu}>{ADMIN_SUPPORT_NAVIGATION_ITEMS.map((supportItem) => {
            const supportActive = tab === "support" && supportItem.intent.supportView === supportView;
            return <li key={supportItem.key}><Link href={buildAdminNavigationHref(supportItem.intent)} aria-current={supportNavigationOpen && supportActive ? "page" : undefined} className={styles.adminNavigationSubmenuLink}>{supportItem.label}</Link></li>;
          })}</ul>
        </details></li>;
      }
      return <li key={item.key}><Link href={buildAdminNavigationHref(item.intent)} aria-current={active ? "page" : undefined} className={styles.adminNavigationLink}>{item.label}</Link></li>;
    })}</ul></nav><div className={styles.adminNavSpacer} /><div className={styles.adminAccount}><span className={styles.adminAccountMark} aria-hidden="true">HA</span><div className={styles.adminAccountIdentity}><strong>Helios Admin</strong><small>{email}</small></div><button {...extensionHydrationProps} onClick={logout} disabled={loggingOut} className={styles.adminLogout}>Log out</button></div>
    </aside><div className={`${styles.adminMain} ${styles.adminWorkspace}`}><header className={styles.adminTopbar}><div><strong>Certalis Admin Console</strong><span>Helios Certification workspace</span></div></header><main className={styles.adminContent}><section ref={routeFocusRef} tabIndex={-1} data-route-focus aria-label="Current Helios Admin workspace" className={styles.adminRouteFocus}><h1 className={styles.adminPageTitle}>Helios Certification Admin</h1>
    {initialRouteNotice ? <div role="alert" style={{ ...mutedPanelStyle, marginBottom: "1rem", borderColor: colors.warning }}>{initialRouteNotice}</div> : null}
    <AdminCandidateRosterFeature active={tab === "candidates"} fetchAdmin={fetchAdmin} />
    <CloudShareConnectionFeature active={tab === "configuration"} fetchAdmin={fetchAdmin} getNavigationHref={getNavigationHref} onNavigate={navigateAdmin} />
    <React.Fragment key="support-workflow-navigation">{tab === "support" ? <section style={{ display: "grid", gap: "1rem" }}><div style={{ ...mutedPanelStyle, display: "grid", gap: "0.75rem" }}><strong>Support workflows</strong><div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>{(["monitoring", "diagnostics", "audit"] as const).map((view) => <button {...extensionHydrationProps} key={view} type="button" aria-current={supportView === view ? "page" : undefined} onClick={() => navigateAdmin({ tab: "support", supportView: view })} style={{ padding: "0.5rem 0.8rem", border: `1px solid ${supportView === view ? colors.textPrimary : colors.border}`, borderRadius: "8px", background: supportView === view ? colors.textPrimary : "#ffffff", color: supportView === view ? "#ffffff" : colors.textPrimary, fontWeight: 600 }}>{getAdminSupportViewLabel(view)}</button>)}</div></div></section> : null}</React.Fragment>
    <AdminExamWorkspaceFeature key="exam-workspace" active={tab === "exams" || (tab === "support" && supportView === "monitoring")} examFeatureActive={tab === "exams"} examView={examView} focusedExamId={focusedExamId} focusedCohortSessionId={focusedCohortSessionId} returnFocusSessionId={returnFocusSessionId} supportMonitoringActive={tab === "support" && supportView === "monitoring"} deliveryView={deliveryView} fetchAdmin={fetchAdmin} onNavigate={navigateAdmin} getNavigationHref={getNavigationHref} onReturnFocusResolved={handleReturnFocusResolved} />
    <AdminSupportFeature active={tab === "support" && supportView !== "monitoring"} view={supportView} diagnosticFilters={diagnosticFilters} fetchAdmin={fetchAdmin} onNavigate={navigateAdmin} />
    </section></main></div>
  </div>;
}
