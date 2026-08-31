"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CloudShareConnectionFeature } from "./admin-cloudshare-connection";
import { AdminSupportFeature } from "./admin-support";
import { createAdminAuthenticatedRequest } from "./admin-authenticated-request";
import { compactButtonStyle, dangerButtonStyle, disabledButtonStyle, primaryButtonStyle, secondaryButtonStyle } from "./button-styles";
import { alertPanelStyle, cardStyle, mutedPanelStyle } from "./card-styles";
import { pageShellStyle } from "./page-shell";
import { SALES_TABS, buildSalesWorkspaceHref, getSalesTabLabel, type SalesItemView, type SalesNavigationIntent, type SalesTab, type SalesWorkspaceRouteState } from "./sales-shell-route";
import { colors } from "./design-tokens";
import { addCloudShareWallClockMinutes, formatCloudShareWallClock } from "@/domain/cloudshare-wall-clock";
import { renderSalesSessionName } from "@/domain/sales-session-name";
import type { SalesExperienceType } from "@/domain/sales-experience-type";
import { parseSalesSessionProvisionDraft, salesSessionProvisionDraftKey, type SalesSessionProvisionDraft } from "./sales-session-provision-draft";
import { SalesSessionsWorkbench } from "./sales-sessions-workbench";
import { SalesTrialOfferingsAdmin } from "./sales-trial-offerings-admin";
import shellStyles from "./sales-workspace.module.css";
import { workspaceTabButtonStyle, workspaceTabNavStyle } from "./workspace-tab-styles";

type Account = { id: string; name: string; kind: "prospect" | "current_customer"; archivedAt: string | null; createdAt: string; updatedAt?: string };
type Opportunity = { id: string; accountId: string; name: string; status: "open" | "won" | "lost"; archivedAt: string | null; createdAt: string; updatedAt?: string };
type Contact = { id: string; opportunityId: string; firstName: string; lastName: string; email: string; archivedAt: string | null; createdAt: string; updatedAt?: string };
type SalesData = { accounts: Account[]; opportunities: Opportunity[]; contacts: Contact[] };
type SalesSelection = { accountId: string | null; opportunityId: string | null };
type Lifecycle = "active" | "archived" | "all";
type Sort = "name" | "created";
type Dialog = { kind: "account"; record?: Account } | { kind: "opportunity"; record?: Opportunity } | { kind: "contact"; record?: Contact } | null;
type Named = { id: string; name: string; friendlyName?: string };
type BlueprintOption = Named & { defaultSnapshotRegionIds?: readonly string[] };
type Policy = Named & { storageLeaseMinutes: number | null };
type Item = { id: string; name: string; description: string; project: Named; blueprints: Named[]; policy: Named; regions: Named[]; defaultDurationMinutes: number; status: "active" | "archived" };
type EnablementSession = { id: string; opportunityId: string; itemId: string; type: SalesExperienceType; start: string; end: string; timeZone: string; salesProDisplayName: string; sessionName?: string; revision?: number; createdAt: string; operation?: { dimension: "certalis_operation"; value: "provisioning" | "correlated" | "needs_attention"; source: "certalis_persistence"; reason?: string; retry: string }; experience?: { dimension: "cloudshare_sales_experience"; value: "notStarted" | "inProgress" | "ended"; source: "cloudshare_v4_get_sales" | "schedule_prediction"; freshness: "fresh" | "predicted"; observedAt?: string }; verificationEligible: boolean; /** Only a server-side live GET contract check may enable a full-PUT name edit. */ editEligible?: boolean };
type SalesParticipantEnvironment = { dimension: "cloudshare_environment"; value: "Future allocation scheduled" | "Allocation scheduled (not running)" | "Ready" | "Suspended" | "Archived" | "Deleted" | "Publishing" | "Taking a Snapshot" | "Preparing" | "Creation Failed" | "In grace" | "Stopping" | "Editing networks" | null; source: "cloudshare_v4_sales_participant_roster" | "cloudshare_v3_environment" | "not_observed" | "not_assigned"; observedAt?: string };
type SalesSessionAccessWindow = { dimension: "certalis_session_access_window"; value: "before_window" | "open" | "closed" | "indeterminate"; source: "schedule_calculation"; nativeInvitationsAvailable: boolean };
type SalesSessionCreationOutcome = { dimension: "certalis_creation"; value: "not_created" | "needs_attention"; source: "certalis_pre_dispatch" | "cloudshare_v4_post_sales_ambiguous" | "certalis_correlation_persistence" | "certalis_support_persistence"; retry: "safe" | "unsafe_requires_support"; reason: string; sessionId?: string };
type SalesParticipant = { id: string; opportunityContactId: string; firstName: string; lastName: string; email: string; invitationStatus: "sent" | "notSent"; lastInvitedAt: string | null; invitedBy: string | null; participationStatus: "pending" | "inProgress" | "concluded"; firstJoined: string | null; envStatus: string | null; environment?: SalesParticipantEnvironment; needsAttention?: boolean; requiresCorrelationRepair?: boolean; monitoringMessage?: string };
type ProjectMember = { email: string; displayName: string };

const blank: SalesData = { accounts: [], opportunities: [], contacts: [] };
const controlStyle = { padding: "0.55rem", border: "1px solid #b7bdc8", borderRadius: "6px", background: "#fff" };
const fullControlStyle = { ...controlStyle, width: "100%", minWidth: 0, boxSizing: "border-box" as const };
const tableStyle = { width: "100%", borderCollapse: "collapse" as const, tableLayout: "fixed" as const, minWidth: "66rem" };
const cellStyle = { padding: "0.7rem 0.65rem", borderBottom: "1px solid #e2e8f0", textAlign: "left" as const, verticalAlign: "middle" as const, whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" };
const monitoringSelectCellStyle = { ...cellStyle, width: "3.5rem", paddingInline: "0.35rem", textAlign: "center" as const };
const monitoringParticipantCellStyle = { ...cellStyle, width: "32%", whiteSpace: "normal" as const };
const monitoringTimeCellStyle = { ...cellStyle, width: "10.5rem", minWidth: "10.5rem", whiteSpace: "normal" as const, overflow: "visible", textOverflow: "clip" };
const actionCellStyle = { ...cellStyle, width: "9.5rem", textAlign: "right" as const };
const selectedRowStyle = { background: "#e8f5f3", boxShadow: "inset 4px 0 0 #0f6d66" };
const selectableRowStyle = { cursor: "pointer" };

/** Standalone callers historically exercise the creation workflow; the routed
 * Sales page always supplies an explicit `sessionView=manage` default. */
export function SalesWorkspace({ email, initialRoute = { tab: "sessions", itemView: "catalog", sessionView: "provision" } }: { readonly email: string; readonly initialRoute?: SalesWorkspaceRouteState }) {
  const router = useRouter();
  const [route, setRoute] = useState<SalesWorkspaceRouteState>(initialRoute);
  const [creationNotice, setCreationNotice] = useState<SalesNavigationIntent["creationNotice"]>();
  useEffect(() => {
    setRoute((current) => salesRoutesMatch(current, initialRoute) ? current : initialRoute);
  }, [initialRoute]);
  const browserFetch = useCallback<typeof fetch>((input, init) => window.fetch(input, init), []);
  const fetchAdmin = useMemo(() => createAdminAuthenticatedRequest({ fetchImpl: browserFetch, onSessionExpired: () => { router.replace("/login"); router.refresh(); } }), [browserFetch, router]);
  const logout = useCallback(async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }, [router]);
  const navigate = useCallback((intent: SalesNavigationIntent) => {
    setCreationNotice(intent.creationNotice);
    const next: SalesWorkspaceRouteState = {
      tab: intent.tab,
      itemView: intent.tab === "items" ? intent.itemView ?? "catalog" : "catalog",
      ...(intent.tab === "sessions" ? { sessionView: intent.sessionView ?? "manage" } : {}),
      ...(intent.tab === "sessions" && intent.sessionId ? { sessionId: intent.sessionId } : {}),
      ...(intent.tab === "sessions" && intent.sessionStatus ? { sessionStatus: intent.sessionStatus } : {}),
      ...(intent.tab === "sessions" && (intent.queueView || route.queueView) ? { queueView: intent.queueView ?? route.queueView ?? "active", queueSort: intent.queueSort ?? route.queueSort ?? "start_desc", queueOffset: intent.queueOffset ?? route.queueOffset ?? 0 } : {}),
      ...(intent.tab === "sessions" && (intent.queueSearch || route.queueSearch) ? { queueSearch: intent.queueSearch ?? route.queueSearch } : {}),
      ...(intent.tab === "sessions" && intent.sessionId && intent.participantsOpen ? { participantsOpen: true } : {}),
      ...(intent.tab === "items" && intent.itemId ? { itemId: intent.itemId } : {}),
      ...((intent.tab === "records" || intent.tab === "sessions") && intent.accountId ? { accountId: intent.accountId } : {}),
      ...((intent.tab === "records" || intent.tab === "sessions") && intent.opportunityId ? { opportunityId: intent.opportunityId } : {}),
      ...(intent.tab === "support" && intent.correlationId ? { correlationId: intent.correlationId } : {}),
    };
    const href = buildSalesWorkspaceHref(intent);
    if (intent.preserveScroll) router.push(href, { scroll: false });
    else router.push(href);
    setRoute(next);
  }, [route.queueOffset, route.queueSearch, route.queueSort, route.queueView, router]);

  return <div className={shellStyles.appShell}>
    <aside className={shellStyles.leftNav} aria-label="Sales workspace navigation">
      <div className={shellStyles.brand}><span className={shellStyles.brandMark} aria-hidden="true">C</span><div className={shellStyles.brandText}><strong>Certalis</strong><small>Sales workspace</small></div></div>
      <nav className={shellStyles.nav} aria-label="Sales workspace sections">{SALES_TABS.map((tab) => {
      const active = route.tab === tab;
      return <button key={tab} className={shellStyles.navButton} data-active={active ? "true" : undefined} type="button" aria-current={active ? "page" : undefined} onClick={() => navigate(tab === "sessions" ? { tab, queueView: "active" } : { tab })}><span className={shellStyles.navIcon} aria-hidden="true">{salesTabIcon(tab)}</span>{getSalesTabLabel(tab)}</button>;
    })}</nav>
      <div className={shellStyles.navSpacer} />
      <div className={shellStyles.account}><span className={shellStyles.accountMark} aria-hidden="true">SA</span><div className={shellStyles.accountText}><strong>Sales admin</strong><small>{email}</small></div></div>
      <button type="button" className={shellStyles.logoutButton} onClick={() => void logout()}>Log out</button>
    </aside>
    <main className={shellStyles.main}>
      <header className={shellStyles.topbar}><div><p>Certalis</p><span>Sales workspace</span></div></header>
      <div className={shellStyles.content}>
    {route.tab === "items" ? <ItemCatalog fetchAdmin={fetchAdmin} view={route.itemView ?? "catalog"} focusedItemId={route.itemId} onNavigate={navigate} /> : null}
    {route.tab === "records" ? <SalesRecordsFeature initialSelection={{ accountId: route.accountId ?? null, opportunityId: route.opportunityId ?? null }} onNavigate={navigate} /> : null}
    {route.tab === "sessions" && route.sessionView !== "provision" && route.queueView ? <SalesSessionsWorkbench route={route} creationNotice={creationNotice} onNavigate={navigate} /> : null}
    {route.tab === "sessions" && (route.sessionView === "provision" || !route.queueView) ? <SalesDemoSessionsFeature draftStorageKey={salesSessionProvisionDraftKey(email)} initialSelection={{ accountId: route.accountId ?? "", opportunityId: route.opportunityId ?? "", view: route.sessionView === "provision" ? "provision" : "manage", focusSessionId: route.sessionId ?? "", status: route.sessionStatus ?? "upcoming", participantsOpen: route.participantsOpen ?? false }} onNavigate={navigate} /> : null}
    {route.tab === "trial-offerings" ? <SalesTrialOfferingsAdmin email={email} fetchAdmin={fetchAdmin} onNavigate={navigate} /> : null}
    {route.tab === "support" ? <section aria-label="Sales support"><PortalSectionIntro title="Sales support" description="Append-only support evidence for Sales records and live Item resource curation in the Certalis Customer workspace." /><AdminSupportFeature active view="diagnostics" diagnosticFilters={{ ...(route.correlationId ? { correlationId: route.correlationId } : {}), ...(route.source ? { source: route.source } : {}), ...(route.subjectId ? { subjectId: route.subjectId } : {}) }} diagnosticsEndpoint="/api/sales/diagnostics" fetchAdmin={fetchAdmin} onNavigate={(intent) => navigate({ tab: "support", correlationId: intent.diagnosticFilters?.correlationId, source: intent.diagnosticFilters?.source, subjectId: intent.diagnosticFilters?.subjectId })} /></section> : null}
    {route.tab === "configuration" ? <section aria-label="Sales configuration"><PortalSectionIntro title="CloudShare Connection" description="Manage the encrypted CloudShare Connection for the isolated Certalis Sales Customer." /><CloudShareConnectionFeature active fetchAdmin={fetchAdmin} getNavigationHref={() => buildSalesWorkspaceHref({ tab: "configuration" })} onNavigate={() => undefined} /></section> : null}</div>
    </main>
  </div>;
}

function salesTabIcon(tab: SalesTab): string {
  switch (tab) {
    case "sessions": return "▣";
    case "trial-offerings": return "◫";
    case "records": return "◇";
    case "items": return "□";
    case "support": return "?";
    case "configuration": return "⚙";
  }
}

function salesRoutesMatch(left: SalesWorkspaceRouteState, right: SalesWorkspaceRouteState): boolean {
  return left.tab === right.tab && left.itemView === right.itemView && left.sessionView === right.sessionView && left.sessionId === right.sessionId && left.sessionStatus === right.sessionStatus && left.queueView === right.queueView && left.queueSearch === right.queueSearch && left.queueSort === right.queueSort && left.queueOffset === right.queueOffset && left.participantsOpen === right.participantsOpen && left.itemId === right.itemId && left.accountId === right.accountId && left.opportunityId === right.opportunityId && left.correlationId === right.correlationId && left.source === right.source && left.subjectId === right.subjectId;
}

function PortalSectionIntro({ title, description }: { title: string; description: string }) {
  return <section style={{ ...mutedPanelStyle, display: "grid", gap: "0.4rem", marginBottom: "1rem" }}><h2 style={{ margin: 0 }}>{title}</h2><p style={{ margin: 0 }}>{description}</p></section>;
}

type SearchableSalesSelectorOption = { readonly id: string; readonly label: string };

interface SearchableSalesSelectorProps {
  readonly label: string; readonly value: string; readonly placeholder: string; readonly options: readonly SearchableSalesSelectorOption[]; readonly helperText: string; readonly loading: boolean; readonly error: string | null; readonly canLoadMore: boolean; readonly onQueryChange: (value: string) => void; readonly onSelect: (option: SearchableSalesSelectorOption) => void; readonly onLoadMore: () => void;
}

function SearchableSalesSelector({ label, value, placeholder, options, helperText, loading, error, canLoadMore, onQueryChange, onSelect, onLoadMore }: SearchableSalesSelectorProps) {
  const [open, setOpen] = useState(false);
  const [activeOptionIndex, setActiveOptionIndex] = useState(-1);
  const selectorRef = useRef<HTMLDivElement>(null);
  const listId = `${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}-results`;
  const inputId = `${listId}-input`;
  const activeOption = options[activeOptionIndex];
  const selectOption = (option: SearchableSalesSelectorOption) => { onSelect(option); setOpen(false); setActiveOptionIndex(-1); };
  const results = open ? <div style={{ position: "absolute", top: "calc(100% + 0.35rem)", zIndex: 2, width: "100%", border: "1px solid #b7bdc8", borderRadius: "6px", background: "#ffffff", boxShadow: "0 0.5rem 1rem rgba(15, 23, 42, 0.15)" }}><div id={listId} role="listbox" aria-label={`${label} results`} style={{ maxHeight: "14rem", overflowY: "auto" }}>{loading ? <p role="status" style={{ margin: 0, padding: "0.65rem" }}>Loading active {label.toLowerCase()}…</p> : error ? <p role="alert" style={{ margin: 0, padding: "0.65rem" }}>{error}</p> : options.length === 0 ? <p style={{ margin: 0, padding: "0.65rem" }}>No active {label.toLowerCase()} match.</p> : options.map((option, index) => <button key={option.id} id={`${listId}-option-${index}`} type="button" role="option" tabIndex={-1} aria-selected={value === option.label} onMouseDown={(event) => event.preventDefault()} onClick={() => selectOption(option)} style={{ display: "block", width: "100%", border: 0, borderBottom: "1px solid #eef2f7", background: index === activeOptionIndex ? "#e8f5f3" : "#ffffff", padding: "0.65rem", textAlign: "left", cursor: "pointer" }}>{option.label}</button>)}</div>{canLoadMore && !loading && !error ? <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onLoadMore} style={{ ...compactButtonStyle, margin: "0.65rem" }}>Load more {label.toLowerCase()}</button> : null}</div> : null;
  return <div ref={selectorRef} data-testid={`${listId}-selector`} style={{ display: "grid", gap: "0.35rem", minWidth: 0 }}>
    <label htmlFor={inputId}>{label}</label>
    <div style={{ position: "relative" }}><input id={inputId} aria-label={label} role="combobox" aria-autocomplete="list" aria-controls={listId} aria-activedescendant={open && activeOption ? `${listId}-option-${activeOptionIndex}` : undefined} aria-expanded={open} autoComplete="off" value={value} placeholder={placeholder} onFocus={() => setOpen(true)} onBlur={(event) => { if (event.relatedTarget instanceof Node && selectorRef.current?.contains(event.relatedTarget)) return; setOpen(false); setActiveOptionIndex(-1); }} onChange={(event) => { onQueryChange(event.target.value); setOpen(true); setActiveOptionIndex(-1); }} onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); setActiveOptionIndex(-1); return; } if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActiveOptionIndex((current) => Math.min(options.length - 1, current + 1)); return; } if (event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setActiveOptionIndex((current) => Math.max(0, current - 1)); return; } if (event.key === "Home") { event.preventDefault(); setOpen(true); setActiveOptionIndex(0); return; } if (event.key === "End") { event.preventDefault(); setOpen(true); setActiveOptionIndex(options.length - 1); return; } if (event.key === "Enter" && open && activeOption) { event.preventDefault(); selectOption(activeOption); } }} style={fullControlStyle} />{results}</div>
    <small style={{ color: "#52606d" }}>{helperText}</small>
  </div>;
}

function SalesDemoSessionsFeature({ initialSelection, draftStorageKey, onNavigate }: { readonly initialSelection: { accountId: string; opportunityId: string; view: "manage" | "provision"; focusSessionId: string; status: "upcoming" | "in_progress" | "needs_attention" | "ended"; participantsOpen: boolean }; readonly draftStorageKey: string; readonly onNavigate: (intent: SalesNavigationIntent) => void }) {
  const router = useRouter();
  const browserFetch = useCallback<typeof fetch>((input, init) => window.fetch(input, init), []);
  const fetchSales = useMemo(() => createAdminAuthenticatedRequest({ fetchImpl: browserFetch, onSessionExpired: () => { router.replace("/login"); router.refresh(); } }), [browserFetch, router]);
  const [items, setItems] = useState<Item[]>([]);
  const [sessions, setSessions] = useState<EnablementSession[]>([]);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editedSessionName, setEditedSessionName] = useState("");
  const [sessionRefresh, setSessionRefresh] = useState(0);
  const [sessionStatusFilter, setSessionStatusFilter] = useState<"upcoming" | "in_progress" | "needs_attention" | "ended">(initialSelection.status);
  const [sessionAccountId, setSessionAccountId] = useState(initialSelection.accountId);
  const [accountSearch, setAccountSearch] = useState("");
  const [accountInput, setAccountInput] = useState("");
  const [accountPage, setAccountPage] = useState(1);
  const [accountTotal, setAccountTotal] = useState(0);
  const [opportunitySearch, setOpportunitySearch] = useState("");
  const [opportunityInput, setOpportunityInput] = useState("");
  const [opportunityPage, setOpportunityPage] = useState(1);
  const [sessionAccounts, setSessionAccounts] = useState<{ id: string; name: string }[]>([]);
  const [sessionOpportunityOptions, setSessionOpportunityOptions] = useState<{ id: string; accountId: string; accountName: string; name: string; label: string }[]>([]);
  const [opportunityTotal, setOpportunityTotal] = useState(0);
  const [nextRevision, setNextRevision] = useState(1);
  const [opportunityId, setOpportunityId] = useState(initialSelection.opportunityId);
  const [itemId, setItemId] = useState("");
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([]);
  const [salesProEmail, setSalesProEmail] = useState("");
  const [projectMemberLoading, setProjectMemberLoading] = useState(false);
  const [startMode, setStartMode] = useState<"now" | "scheduled">("now");
  const [start, setStart] = useState(() => formatCloudShareWallClock(new Date(), "UTC") ?? "");
  const [end, setEnd] = useState("");
  const [endHasManualOverride, setEndHasManualOverride] = useState(false);
  const [timeZone, setTimeZone] = useState("UTC");
  const [type, setType] = useState<SalesExperienceType>("demo");
  const [timezones, setTimezones] = useState<{ id: string; name: string }[]>([]);
  const [timezoneFreshness, setTimezoneFreshness] = useState<string | null>(null);
  const [timezoneCorrelationId, setTimezoneCorrelationId] = useState<string | null>(null);
  const [sessionNameTemplate, setSessionNameTemplate] = useState("{account} - {opportunity} ({revision}) - {item}");
  const [message, setMessage] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | null>(null);
  const [needsAttention, setNeedsAttention] = useState(false);
  const [creationRetryBlocked, setCreationRetryBlocked] = useState(false);
  const [sessionOperationMessage, setSessionOperationMessage] = useState<string | null>(null);
  const [sessionOperationCorrelationId, setSessionOperationCorrelationId] = useState<string | null>(null);
  const [sessionOperationFailed, setSessionOperationFailed] = useState(false);
  const [verifyingSessionId, setVerifyingSessionId] = useState<string | null>(null);
  const [participantSessionId, setParticipantSessionId] = useState<string | null>(initialSelection.participantsOpen ? initialSelection.focusSessionId || null : null);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [templateSaveMessage, setTemplateSaveMessage] = useState<string | null>(null);
  const [templateSaveCorrelationId, setTemplateSaveCorrelationId] = useState<string | null>(null);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [participantSearch, setParticipantSearch] = useState("");
  const [participantMatches, setParticipantMatches] = useState<Array<{ id: string; sessionId: string; sessionName: string; firstName: string; lastName: string; email: string; operation: NonNullable<EnablementSession["operation"]>; experience: NonNullable<EnablementSession["experience"]>; environment: { dimension: "cloudshare_environment"; value: string | null; source: string } }>>([]);
  const [participantSearchMessage, setParticipantSearchMessage] = useState<string | null>(null);
  const [participantSearchOffset, setParticipantSearchOffset] = useState(0);
  const [participantSearchTotal, setParticipantSearchTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const currentStart = useRef(start);
  const currentTimeZone = useRef(timeZone);
  const currentType = useRef(type);
  const salesPreferenceDirty = useRef({ timeZone: false, experienceType: false });
  const persistedSalesPreference = useRef({ timeZone, experienceType: type });
  const restoringDraftItem = useRef(false);
  const draftHasPreferences = useRef(false);
  const draftHasTemplate = useRef(false);
  const currentSessionSelection = useRef({ accountId: initialSelection.accountId, opportunityId: initialSelection.opportunityId });
  const selectedItem = items.find((item) => item.id === itemId) ?? null;
  const selectedItemDuration = selectedItem?.defaultDurationMinutes;

  useEffect(() => { setParticipantSessionId(initialSelection.participantsOpen ? initialSelection.focusSessionId || null : null); }, [initialSelection.focusSessionId, initialSelection.participantsOpen]);

  useEffect(() => {
    if (initialSelection.view !== "provision") {
      setDraftHydrated(true);
      return;
    }
    const draft = parseSalesSessionProvisionDraft(window.sessionStorage.getItem(draftStorageKey));
    if (draft) {
      restoringDraftItem.current = Boolean(draft.itemId);
      draftHasPreferences.current = true;
      draftHasTemplate.current = true;
      setSessionAccountId(currentSessionSelection.current.accountId || draft.accountId);
      setOpportunityId(currentSessionSelection.current.opportunityId || draft.opportunityId);
      setItemId(draft.itemId); setSalesProEmail(draft.salesProEmail); setStartMode(draft.startMode); setStart(draft.start); setEnd(draft.end); setEndHasManualOverride(draft.endHasManualOverride); setTimeZone(draft.timeZone); setType(draft.type); setSessionNameTemplate(draft.sessionNameTemplate);
    }
    setDraftHydrated(true);
  }, [draftStorageKey, initialSelection.view]);

  useEffect(() => {
    if (!draftHydrated || initialSelection.view !== "provision") return;
    const draft: SalesSessionProvisionDraft = { version: 1, accountId: sessionAccountId, opportunityId, itemId, salesProEmail, startMode, start, end, endHasManualOverride, timeZone, type, sessionNameTemplate };
    window.sessionStorage.setItem(draftStorageKey, JSON.stringify(draft));
  }, [draftHydrated, draftStorageKey, initialSelection.view, sessionAccountId, opportunityId, itemId, salesProEmail, startMode, start, end, endHasManualOverride, timeZone, type, sessionNameTemplate]);

  useEffect(() => { currentSessionSelection.current = { accountId: sessionAccountId, opportunityId }; }, [sessionAccountId, opportunityId]);
  useEffect(() => { setSessionStatusFilter(initialSelection.status); }, [initialSelection.status]);
  // Browser Back/Forward may update only the filter query. Restore those choices without remounting the in-progress form.
  useEffect(() => {
    if (initialSelection.accountId !== currentSessionSelection.current.accountId) {
      setSessionAccountId(initialSelection.accountId); setAccountInput(""); setAccountSearch(""); setAccountPage(1);
    }
    if (initialSelection.opportunityId !== currentSessionSelection.current.opportunityId) {
      setOpportunityId(initialSelection.opportunityId); setOpportunityInput(""); setOpportunitySearch(""); setOpportunityPage(1);
    }
  }, [initialSelection.accountId, initialSelection.opportunityId]);

  useEffect(() => { currentStart.current = start; currentTimeZone.current = timeZone; currentType.current = type; }, [start, timeZone, type]);
  useEffect(() => { void fetchSales("/api/sales/session-configuration", { cache: "no-store" }).then(async (response) => { const body = await response.json() as { template?: string }; if (response.ok && body.template && !draftHasTemplate.current) setSessionNameTemplate(body.template); }); }, [fetchSales]);
  useEffect(() => { let active = true; void fetchSales("/api/sales/timezones", { cache: "no-store" }).then(async (response) => { const body = await response.json() as { timezones?: { id: string; name: string }[]; freshness?: string; correlationId?: string; preference?: { timeZone?: string | null; experienceType?: SalesExperienceType | null } }; if (!active) return; if (!response.ok) { setMessage("CloudShare timezones could not be loaded."); setTimezoneCorrelationId(body.correlationId ?? null); return; } setTimezones(body.timezones ?? []); setTimezoneFreshness(body.freshness ?? null); setTimezoneCorrelationId(body.correlationId ?? null); if (!draftHasPreferences.current) { const savedTimeZone = body.preference?.timeZone ?? currentTimeZone.current; const savedType = body.preference?.experienceType ?? currentType.current; const nextTimeZone = !salesPreferenceDirty.current.timeZone && body.preference?.timeZone ? body.preference.timeZone : currentTimeZone.current; const nextType = !salesPreferenceDirty.current.experienceType && body.preference?.experienceType ? body.preference.experienceType : currentType.current; persistedSalesPreference.current = { timeZone: savedTimeZone, experienceType: savedType }; if (nextTimeZone !== currentTimeZone.current) setTimeZone(nextTimeZone); if (nextType !== currentType.current) setType(nextType); } }).catch(() => { if (active) setMessage("CloudShare timezones could not be loaded."); }); return () => { active = false; }; }, [fetchSales]);
  useEffect(() => { if ((!salesPreferenceDirty.current.timeZone && !salesPreferenceDirty.current.experienceType) || timezones.length === 0) return; const preference = { timeZone, experienceType: type }; if (persistedSalesPreference.current.timeZone === preference.timeZone && persistedSalesPreference.current.experienceType === preference.experienceType) return; persistedSalesPreference.current = preference; void fetchSales("/api/sales/timezones", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(preference) }); }, [fetchSales, timeZone, type, timezones.length]);

  const load = useCallback(async () => {
    const itemResponse = await fetchSales("/api/sales/items", { cache: "no-store" });
    const itemBody = await itemResponse.json() as { activeItems?: Item[]; error?: string };
    if (!itemResponse.ok) throw new Error(itemBody.error ?? "Could not load Sales Enablement Session choices.");
    setItems(itemBody.activeItems ?? []);
  }, [fetchSales]);
  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "Could not load Sales Enablement Session choices.")); }, [load]);
  useEffect(() => {
    if (!selectedItemDuration) return;
    if (restoringDraftItem.current) { restoringDraftItem.current = false; return; }
    setEndHasManualOverride(false);
    setEnd(addCloudShareWallClockMinutes(currentStart.current, currentTimeZone.current, selectedItemDuration) ?? "");
  }, [itemId, selectedItemDuration]);
  useEffect(() => { if (selectedItemDuration && startMode === "now") setStart(formatCloudShareWallClock(new Date(), timeZone) ?? ""); }, [startMode, selectedItemDuration, timeZone]);
  useEffect(() => { if (selectedItemDuration && !endHasManualOverride) setEnd(addCloudShareWallClockMinutes(start, timeZone, selectedItemDuration) ?? ""); }, [start, selectedItemDuration, timeZone, endHasManualOverride]);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ accountPage: String(accountPage), accountPageSize: "20", page: String(opportunityPage), pageSize: "20" });
    if (accountSearch.trim()) query.set("accountSearch", accountSearch.trim()); if (sessionAccountId) query.set("accountId", sessionAccountId); if (opportunityId) query.set("selectedOpportunityId", opportunityId); if (opportunitySearch.trim()) query.set("search", opportunitySearch.trim());
    setSelectionLoading(true); setSelectionError(null);
    if (accountPage === 1) setSessionAccounts([]); if (opportunityPage === 1) setSessionOpportunityOptions([]);
    void fetchSales(`/api/sales/session-opportunities?${query.toString()}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const body = await response.json() as { accounts?: { id: string; name: string }[]; accountTotal?: number; opportunities?: { id: string; accountId: string; accountName: string; name: string; label: string }[]; total?: number; nextRevision?: number; error?: string };
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(body.error ?? "Could not load active Account and Opportunity choices.");
      setSessionAccounts((current) => accountPage === 1 ? body.accounts ?? [] : [...current, ...(body.accounts ?? []).filter((account) => !current.some((existing) => existing.id === account.id))]);
      setAccountTotal(body.accountTotal ?? 0);
      setSessionOpportunityOptions((current) => opportunityPage === 1 ? body.opportunities ?? [] : [...current, ...(body.opportunities ?? []).filter((opportunity) => !current.some((existing) => existing.id === opportunity.id))]);
      setOpportunityTotal(body.total ?? 0); setNextRevision(body.nextRevision ?? 1);
    }).catch((error) => { if (!controller.signal.aborted) setSelectionError(error instanceof Error ? error.message : "Could not load active Account and Opportunity choices."); }).finally(() => { if (!controller.signal.aborted) setSelectionLoading(false); });
    return () => controller.abort();
  }, [accountPage, accountSearch, fetchSales, opportunityId, opportunityPage, opportunitySearch, sessionAccountId]);
  useEffect(() => { let active = true; const refresh = () => { const query = new URLSearchParams(); if (sessionStatusFilter === "needs_attention") query.set("operationStatus", "needs_attention"); else query.set("experienceStatus", sessionStatusFilter === "upcoming" ? "notStarted" : sessionStatusFilter === "in_progress" ? "inProgress" : "ended"); if (sessionAccountId) query.set("accountId", sessionAccountId); if (opportunityId) query.set("opportunityId", opportunityId); return void fetchSales(`/api/sales/enablement-sessions?${query.toString()}`, { cache: "no-store" }).then(async (response) => { const body = await response.json() as { sessions?: EnablementSession[] }; if (active && response.ok) setSessions(body.sessions ?? []); }).catch(() => undefined); }; refresh(); const interval = window.setInterval(refresh, 30_000); return () => { active = false; window.clearInterval(interval); }; }, [fetchSales, opportunityId, sessionAccountId, sessionStatusFilter, sessionRefresh]);
  useEffect(() => {
    setProjectMembers([]);
    if (!itemId) return;
    setProjectMemberLoading(true);
    void fetchSales(`/api/sales/enablement-sessions/project-members?itemId=${encodeURIComponent(itemId)}`, { cache: "no-store" })
      .then(async (response) => { const body = await response.json() as { members?: ProjectMember[]; error?: string }; if (!response.ok) throw new Error(body.error ?? "Could not retrieve active Project members."); const members = body.members ?? []; setProjectMembers(members); setSalesProEmail((current) => current && members.some((member) => member.email === current) ? current : ""); })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Could not retrieve active Project members."))
      .finally(() => setProjectMemberLoading(false));
  }, [fetchSales, itemId]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setMessage(null); setCorrelationId(null); setNeedsAttention(false); setLoading(true);
    try {
      const response = await fetchSales("/api/sales/enablement-sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ opportunityId, itemId, salesProEmail, start, end, timeZone, type, sessionNameTemplate }) });
      const body = await response.json() as { error?: string; correlationId?: string; session?: EnablementSession; needsAttention?: boolean; warning?: string; creationOutcome?: SalesSessionCreationOutcome };
      if (!response.ok) {
        setCorrelationId(body.correlationId ?? null);
        if (body.creationOutcome?.retry === "unsafe_requires_support") {
          setNeedsAttention(true); setCreationRetryBlocked(true); setMessage(body.creationOutcome.reason || body.error || "Creation outcome is unknown. Review support diagnostics and do not retry.");
          return;
        }
        throw new Error(body.error ?? "Could not provision the Sales Enablement Session.");
      }
      setSessions((current) => body.session ? [body.session, ...current] : current);
      if (body.session) {
        window.sessionStorage.removeItem(draftStorageKey);
        setItemId(""); setSalesProEmail(""); setEnd(""); setEndHasManualOverride(false);
        if (body.needsAttention) { setNeedsAttention(true); setCreationRetryBlocked(true); setCorrelationId(body.correlationId ?? null); setMessage(`Needs attention: ${body.warning ?? body.creationOutcome?.reason ?? "Sales Enablement Session was created. Do not retry creation; review support diagnostics."}`); }
        const createdStatus = body.needsAttention ? "needs_attention" : body.session.experience?.value === "ended" ? "ended" : body.session.experience?.value === "inProgress" || startMode === "now" ? "in_progress" : "upcoming";
        setSessionStatusFilter(createdStatus);
        onNavigate({
          tab: "sessions",
          sessionView: "manage",
          queueView: body.needsAttention ? "needs_attention" : "active",
          queueOffset: 0,
          sessionId: body.session.id,
          sessionStatus: createdStatus,
          accountId: sessionAccountId,
          opportunityId,
          ...(body.needsAttention ? {
            creationNotice: {
              message: `Needs attention: ${body.warning ?? body.creationOutcome?.reason ?? "Sales Enablement Session was created. Do not retry creation; review support diagnostics."}`,
              ...(body.correlationId ? { correlationId: body.correlationId } : {}),
            },
          } : {}),
        });
      } else if (body.needsAttention) {
        setNeedsAttention(true); setCreationRetryBlocked(true); setCorrelationId(body.correlationId ?? null);
        setMessage(`Needs attention: ${body.warning ?? body.creationOutcome?.reason ?? "Sales Enablement Session creation needs support. Do not retry creation."}`);
      } else setMessage("Sales Enablement Session created. No invitations were sent.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not provision the Sales Enablement Session."); } finally { setLoading(false); }
  };
  const runSessionOperation = async (request: () => Promise<Response>, fallback: string, success?: string, onSuccess?: () => void) => {
    setSessionOperationMessage(null); setSessionOperationCorrelationId(null); setSessionOperationFailed(false);
    try {
      const response = await request();
      let body: { error?: string; correlationId?: string } = {};
      try { body = await response.json() as { error?: string; correlationId?: string }; } catch { /* A successful operation may intentionally have no JSON body. */ }
      if (!response.ok) { setSessionOperationMessage(body.error ?? fallback); setSessionOperationCorrelationId(body.correlationId ?? null); setSessionOperationFailed(true); return; }
      setSessionOperationMessage(success ?? "Sales Session updated."); setSessionOperationCorrelationId(body.correlationId ?? null); onSuccess?.(); setSessionRefresh((value) => value + 1);
    } catch { setSessionOperationMessage(fallback); setSessionOperationFailed(true); }
  };
  const saveSessionNameTemplate = async () => {
    setTemplateSaveMessage(null); setTemplateSaveCorrelationId(null); setTemplateSaving(true);
    try {
      const response = await fetchSales("/api/sales/session-configuration", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ template: sessionNameTemplate }) });
      const body = await response.json() as { error?: string; correlationId?: string };
      if (!response.ok) { setTemplateSaveCorrelationId(body.correlationId ?? null); throw new Error(body.error ?? "Could not save the default Session name template."); }
      setTemplateSaveMessage("Default Session name template saved for future Sales Enablement Sessions.");
    } catch (error) { setTemplateSaveMessage(error instanceof Error ? error.message : "Could not save the default Session name template."); } finally { setTemplateSaving(false); }
  };
  const selectedOpportunity = sessionOpportunityOptions.find((opportunity) => opportunity.id === opportunityId);
  useEffect(() => { const account = sessionAccounts.find((candidate) => candidate.id === sessionAccountId); if (account) setAccountInput(account.name); }, [sessionAccountId, sessionAccounts]);
  useEffect(() => { if (selectedOpportunity) setOpportunityInput(selectedOpportunity.label); }, [selectedOpportunity]);
  const previewAccount = selectedOpportunity?.accountName ?? "Account";
  const previewOpportunity = selectedOpportunity?.name ?? "Opportunity";
  const previewName = renderSalesSessionName(sessionNameTemplate, { account: previewAccount, opportunity: previewOpportunity, revision: nextRevision, item: selectedItem?.name ?? "Item" });
  const templateError = previewName ? null : "Template must include {revision}, use supported placeholders, and render to at most 100 characters.";
  const searchParticipants = async (offset: number) => {
    setParticipantSearchMessage(null);
    try {
      const response = await fetchSales(`/api/sales/enablement-sessions?participantSearch=${encodeURIComponent(participantSearch)}&offset=${offset}&limit=20`, { cache: "no-store" });
      const body = await response.json() as { participants?: typeof participantMatches; total?: number; offset?: number; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not search participants.");
      setParticipantMatches(body.participants ?? []); setParticipantSearchTotal(body.total ?? 0); setParticipantSearchOffset(body.offset ?? offset);
    } catch (error) { setParticipantMatches([]); setParticipantSearchTotal(0); setParticipantSearchMessage(error instanceof Error ? error.message : "Could not search participants."); }
  };
  const isProvision = initialSelection.view === "provision";
  return <section aria-label="Sales Enablement Sessions">
    <style>{`
      .sales-session-provisioning-grid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(14rem, 1fr) minmax(14rem, 1fr); gap: 1rem; align-items: start; }
      .sales-session-selector-group { display: grid; gap: 0.65rem; min-width: 0; }
      .sales-session-selector-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
      .sales-session-template-controls { display: grid; grid-template-columns: minmax(0, 40rem) auto; gap: 0.75rem; align-items: start; }
      .sales-session-template-action { align-self: start; margin-top: calc(1.2em + 0.35rem); }
      @media (max-width: 72rem) { .sales-session-provisioning-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .sales-session-selector-group { grid-column: span 2; } }
      @media (max-width: 42rem) { .sales-session-provisioning-grid, .sales-session-selector-fields, .sales-session-template-controls { grid-template-columns: minmax(0, 1fr); } .sales-session-selector-group { grid-column: auto; } .sales-session-template-action { margin-top: 0; } }
    `}</style>
    <nav aria-label="Sales Session workspace views" style={workspaceTabNavStyle}><button type="button" aria-current={!isProvision ? "page" : undefined} onClick={() => onNavigate({ tab: "sessions", accountId: sessionAccountId, opportunityId, sessionView: "manage", queueView: "active", queueOffset: 0 })} style={workspaceTabButtonStyle(!isProvision)}>Manage</button><button type="button" aria-current={isProvision ? "page" : undefined} onClick={() => onNavigate({ tab: "sessions", accountId: sessionAccountId, opportunityId, sessionView: "provision" })} style={workspaceTabButtonStyle(isProvision)}>Provision</button></nav>
    {isProvision ? <>
    <PortalSectionIntro title="Provision a Sales Enablement Session" description="Creates one time-bound CloudShare Sales Experience. Registration does not send email; Sales Admins explicitly request native invitations for selected registered participants afterwards." />
    <form onSubmit={submit} style={{ ...cardStyle, padding: "1.25rem", display: "grid", gap: "1rem" }}>
      <div className="sales-session-provisioning-grid">
        <div className="sales-session-selector-group"><div className="sales-session-selector-fields"><SearchableSalesSelector label="Account" value={accountInput} placeholder="Search active Accounts" options={sessionAccounts.map((account) => ({ id: account.id, label: account.name }))} helperText="Only active Accounts are available for new Sales Enablement Sessions." loading={selectionLoading} error={selectionError} canLoadMore={accountTotal > sessionAccounts.length} onQueryChange={(value) => { setAccountInput(value); setAccountSearch(value); setAccountPage(1); setOpportunityPage(1); if (sessionAccountId) { setSessionAccountId(""); setOpportunityId(""); setOpportunityInput(""); } }} onSelect={(account) => { setSessionAccountId(account.id); setAccountInput(account.label); setAccountSearch(account.label); setAccountPage(1); setOpportunityId(""); setOpportunityInput(""); setOpportunitySearch(""); setOpportunityPage(1); onNavigate({ tab: "sessions", sessionView: "provision", accountId: account.id, preserveScroll: true }); }} onLoadMore={() => setAccountPage((page) => page + 1)} /><SearchableSalesSelector label="Opportunity" value={opportunityInput} placeholder="Search active Opportunities" options={sessionOpportunityOptions.map((opportunity) => ({ id: opportunity.id, label: opportunity.label }))} helperText={sessionAccountId ? "Only active Opportunities for the selected active Account are available." : `Showing ${opportunityTotal} active Opportunities across active Accounts. Select an Account to narrow the list.`} loading={selectionLoading} error={selectionError} canLoadMore={opportunityTotal > sessionOpportunityOptions.length} onQueryChange={(value) => { setOpportunityInput(value); setOpportunitySearch(value); setOpportunityPage(1); if (opportunityId) setOpportunityId(""); }} onSelect={(opportunity) => { setOpportunityId(opportunity.id); setOpportunityInput(opportunity.label); setOpportunitySearch(""); setOpportunityPage(1); onNavigate({ tab: "sessions", sessionView: "provision", accountId: sessionAccountId, opportunityId: opportunity.id, preserveScroll: true }); }} onLoadMore={() => setOpportunityPage((page) => page + 1)} /></div><div><button type="button" style={!sessionAccountId && !opportunityId && !accountInput && !opportunityInput ? { ...secondaryButtonStyle, ...disabledButtonStyle } : secondaryButtonStyle} disabled={!sessionAccountId && !opportunityId && !accountInput && !opportunityInput} onClick={() => { setSessionAccountId(""); setOpportunityId(""); setAccountInput(""); setAccountSearch(""); setAccountPage(1); setOpportunityInput(""); setOpportunitySearch(""); setOpportunityPage(1); onNavigate({ tab: "sessions", sessionView: "provision", preserveScroll: true }); }}>Clear Account and Opportunity filters</button></div></div>
        <div style={{ display: "grid", gap: "0.75rem", minWidth: 0 }}><label style={{ display: "grid", gap: "0.35rem" }}>Catalogue Item<select aria-label="Catalogue Item" required value={itemId} onChange={(event) => setItemId(event.target.value)} style={fullControlStyle}><option value="">Select a Catalogue Item</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label style={{ display: "grid", gap: "0.35rem" }}>Sales Experience type<select aria-label="Sales Experience type" value={type} onChange={(event) => { salesPreferenceDirty.current.experienceType = true; setType(event.target.value as SalesExperienceType); }} style={fullControlStyle}><option value="demo">Demo</option><option value="poc">POC</option><option value="pov">POV</option><option value="trial">Trial</option></select></label></div>
        <div style={{ display: "grid", gap: "0.75rem", minWidth: 0 }}><label style={{ display: "grid", gap: "0.35rem" }}>Sales Pro<select aria-label="Sales Pro" required value={salesProEmail} onChange={(event) => setSalesProEmail(event.target.value)} disabled={!itemId || projectMemberLoading} style={fullControlStyle}><option value="">{projectMemberLoading ? "Loading active Project members…" : "Select an active Project member"}</option>{projectMembers.map((member) => <option key={member.email} value={member.email}>{member.displayName} ({member.email})</option>)}</select></label><label style={{ display: "grid", gap: "0.35rem" }}>Time zone<input aria-label="Time zone" list="cloudshare-timezones" required value={timeZone} onChange={(event) => { salesPreferenceDirty.current.timeZone = true; setTimeZone(event.target.value); }} style={fullControlStyle} /><datalist id="cloudshare-timezones">{timezones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</datalist>{timezoneFreshness === "stale" ? <small role="status" style={{ color: colors.warning }}>CloudShare time-zone list is temporarily cached. Review the selected value before creating a session.</small> : null}{timezoneCorrelationId ? <button type="button" onClick={() => onNavigate({ tab: "support", correlationId: timezoneCorrelationId })} style={compactButtonStyle}>Timezone support diagnostics</button> : null}</label></div>
      </div>
      <fieldset style={{ border: "1px solid #d8dee8", borderRadius: "8px", padding: "0.85rem", display: "grid", gap: "0.7rem" }}><legend>Time window</legend><div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}><label><input type="radio" checked={startMode === "now"} onChange={() => setStartMode("now")} /> Start now</label><label><input type="radio" checked={startMode === "scheduled"} onChange={() => setStartMode("scheduled")} /> Schedule start</label></div><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))", gap: "1rem" }}><label style={{ display: "grid", gap: "0.35rem" }}>Start <input aria-label="Start" type="datetime-local" required value={start} disabled={startMode === "now"} onChange={(event) => setStart(event.target.value)} style={fullControlStyle} /></label><label style={{ display: "grid", gap: "0.35rem" }}>End <input aria-label="End" type="datetime-local" required value={end} onChange={(event) => { setEndHasManualOverride(true); setEnd(event.target.value); }} style={fullControlStyle} /></label></div><p style={{ margin: 0, color: "#52606d" }}>End is required and initially prefilled from the selected Item Policy storage lease; the Sales Admin may override it. All displayed values are local CloudShare date-times in the selected explicit time zone.</p></fieldset>
      <fieldset style={{ border: "1px solid #d8dee8", borderRadius: "8px", padding: "0.85rem", display: "grid", gap: "0.5rem" }}><legend>Session name template</legend><p style={{ margin: 0, color: "#52606d" }}>Use {"{account}"}, {"{opportunity}"}, {"{revision}"}, and {"{item}"}. {"{revision}"} is required and the rendered name must be 100 characters or fewer. Saving changes the default used for future Sales Enablement Sessions.</p><div className="sales-session-template-controls"><label style={{ display: "grid", gap: "0.35rem", minWidth: 0 }}>Template <input aria-label="Session name template" value={sessionNameTemplate} onChange={(event) => setSessionNameTemplate(event.target.value)} style={fullControlStyle} /></label><button className="sales-session-template-action" type="button" disabled={!previewName || templateSaving} onClick={() => void saveSessionNameTemplate()} style={!previewName || templateSaving ? { ...secondaryButtonStyle, ...disabledButtonStyle, justifySelf: "start" } : { ...secondaryButtonStyle, justifySelf: "start" }}>{templateSaving ? "Saving default template…" : "Save as default template"}</button></div><output aria-label="Session name preview">{previewName ? `Preview: ${previewName}` : templateError}</output>{templateSaveMessage ? <div role={templateSaveCorrelationId ? "alert" : "status"}>{templateSaveMessage}{templateSaveCorrelationId ? <> <button type="button" onClick={() => onNavigate({ tab: "support", correlationId: templateSaveCorrelationId })} style={{ border: 0, background: "transparent", color: colors.info, textDecoration: "underline", cursor: "pointer" }}>Open support diagnostics ({templateSaveCorrelationId})</button></> : null}</div> : null}</fieldset>
      <div style={{ display: "flex", justifyContent: "end", gap: "0.75rem", alignItems: "center" }}><button style={primaryButtonStyle} disabled={creationRetryBlocked || loading || projectMemberLoading || !previewName || !opportunityId || !itemId || !salesProEmail}>{loading ? "Provisioning…" : "Create Sales Enablement Session"}</button></div>
      {message ? <div role={correlationId ? "alert" : "status"} style={correlationId ? alertPanelStyle.danger : alertPanelStyle.success}>{message}{needsAttention ? <strong> Do not retry creation.</strong> : null}{correlationId ? <> <button type="button" onClick={() => onNavigate({ tab: "support", correlationId })} style={{ border: 0, background: "transparent", color: colors.info, textDecoration: "underline", cursor: "pointer" }}>Open support diagnostics ({correlationId})</button></> : null}</div> : null}
    </form>
    </> : null}
    {!isProvision ? <section style={{ ...cardStyle, marginTop: "1rem", padding: "1.25rem" }} aria-label="Sales Enablement Session operations">
      {message && needsAttention ? <div role="alert" style={alertPanelStyle.danger}>{message}<strong> Do not retry creation.</strong>{correlationId ? <> <button type="button" onClick={() => onNavigate({ tab: "support", correlationId })} style={{ border: 0, background: "transparent", color: colors.info, textDecoration: "underline", cursor: "pointer" }}>Open support diagnostics ({correlationId})</button></> : null}</div> : null}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}><h2 style={{ margin: 0 }}>Manage Sales Enablement Sessions</h2><label>Operational view <select aria-label="Operational view" value={sessionStatusFilter} onChange={(event) => { const status = event.target.value as typeof sessionStatusFilter; setSessionStatusFilter(status); onNavigate({ tab: "sessions", sessionView: "manage", sessionStatus: status, accountId: sessionAccountId, opportunityId, preserveScroll: true }); }} style={controlStyle}><option value="upcoming">Upcoming · CloudShare Experience notStarted</option><option value="in_progress">In progress · CloudShare Experience inProgress</option><option value="needs_attention">Needs attention · Certalis operation exception</option><option value="ended">Ended history · CloudShare Experience ended</option></select></label></div>
      <p style={{ margin: "0.65rem 0", color: "#52606d" }}>Experience status is CloudShare when a fresh documented read exists; otherwise Certalis labels it as a schedule prediction. Needs attention is a separate Certalis operation exception.</p>
      <fieldset style={{ display: "grid", gap: "0.65rem", marginBottom: "0.75rem" }}><legend>Account-first Session filters</legend><div className="sales-session-selector-fields"><SearchableSalesSelector label="Account" value={accountInput} placeholder="Search active Accounts" options={sessionAccounts.map((account) => ({ id: account.id, label: account.name }))} helperText="Select an Account before narrowing to its Opportunity." loading={selectionLoading} error={selectionError} canLoadMore={accountTotal > sessionAccounts.length} onQueryChange={(value) => { setAccountInput(value); setAccountSearch(value); setAccountPage(1); if (sessionAccountId) { setSessionAccountId(""); setOpportunityId(""); setOpportunityInput(""); } }} onSelect={(account) => { setSessionAccountId(account.id); setAccountInput(account.label); setOpportunityId(""); setOpportunityInput(""); onNavigate({ tab: "sessions", sessionView: "manage", accountId: account.id, preserveScroll: true }); }} onLoadMore={() => setAccountPage((page) => page + 1)} /><SearchableSalesSelector label="Opportunity" value={opportunityInput} placeholder="Search active Opportunities" options={sessionOpportunityOptions.map((opportunity) => ({ id: opportunity.id, label: opportunity.label }))} helperText={sessionAccountId ? "Only Opportunities for the selected Account are shown." : "Select an Account first to narrow the operational view."} loading={selectionLoading} error={selectionError} canLoadMore={opportunityTotal > sessionOpportunityOptions.length} onQueryChange={(value) => { setOpportunityInput(value); setOpportunitySearch(value); setOpportunityPage(1); if (opportunityId) setOpportunityId(""); }} onSelect={(opportunity) => { setOpportunityId(opportunity.id); setOpportunityInput(opportunity.label); onNavigate({ tab: "sessions", sessionView: "manage", accountId: sessionAccountId, opportunityId: opportunity.id, preserveScroll: true }); }} onLoadMore={() => setOpportunityPage((page) => page + 1)} /></div><button type="button" style={secondaryButtonStyle} disabled={!sessionAccountId && !opportunityId} onClick={() => { setSessionAccountId(""); setOpportunityId(""); setAccountInput(""); setAccountSearch(""); setOpportunityInput(""); setOpportunitySearch(""); onNavigate({ tab: "sessions", sessionView: "manage", preserveScroll: true }); }}>Clear Account and Opportunity filters</button></fieldset>
      <form onSubmit={(event) => { event.preventDefault(); void searchParticipants(0); }} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}><label>Search participant name or email <input aria-label="Search participant name or email" value={participantSearch} onChange={(event) => { setParticipantSearch(event.target.value); setParticipantSearchOffset(0); }} style={controlStyle} /></label><button type="submit" style={secondaryButtonStyle}>Search</button></form>
      {participantSearchMessage ? <p role="alert">{participantSearchMessage}</p> : null}{participantMatches.length ? <><p role="status">Showing {participantSearchOffset + 1}–{Math.min(participantSearchOffset + participantMatches.length, participantSearchTotal)} of {participantSearchTotal} matching participants.</p><ul aria-label="Participant search results">{participantMatches.map((match) => <li key={match.id}><button type="button" style={compactButtonStyle} onClick={() => { const status = match.operation.value === "needs_attention" ? "needs_attention" : match.experience.value === "notStarted" ? "upcoming" : match.experience.value === "inProgress" ? "in_progress" : "ended"; setSessionStatusFilter(status); setParticipantSessionId(match.sessionId); onNavigate({ tab: "sessions", sessionView: "manage", sessionId: match.sessionId, sessionStatus: status, participantsOpen: true }); }}>{match.firstName} {match.lastName} ({match.email})</button> · Session: {match.sessionName} · Environment state: {match.environment.value ?? (match.environment.source === "not_assigned" ? "not assigned" : "not observed")} ({match.environment.dimension}, {match.environment.source})</li>)}</ul><div style={{ display: "flex", gap: "0.5rem" }}><button type="button" disabled={participantSearchOffset === 0} onClick={() => void searchParticipants(Math.max(0, participantSearchOffset - 20))}>Previous participant results</button><button type="button" disabled={participantSearchOffset + participantMatches.length >= participantSearchTotal} onClick={() => void searchParticipants(participantSearchOffset + 20)}>Next participant results</button></div></> : null}
      {sessions.length === 0 ? <p>No persisted Sales Enablement Sessions match this operational view.</p> : <ul>{sessions.map((session) => <li key={session.id} id={`sales-session-${session.id}`} style={initialSelection.focusSessionId === session.id ? { ...selectedRowStyle, padding: "0.4rem" } : undefined}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", margin: "0.4rem 0" }}>
          <div role="group" aria-label={`Session actions for ${session.sessionName ?? session.type.toUpperCase()}, revision ${session.revision ?? 1}`} style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            {editingSessionId !== session.id && session.experience?.value === "notStarted" && session.editEligible === true ? <button type="button" style={compactButtonStyle} onClick={() => { setEditingSessionId(session.id); setEditedSessionName(session.sessionName ?? ""); }}>Edit name</button> : null}
            {session.verificationEligible === true ? <button type="button" disabled={verifyingSessionId === session.id} style={verifyingSessionId === session.id ? { ...compactButtonStyle, ...disabledButtonStyle } : compactButtonStyle} onClick={() => { setVerifyingSessionId(session.id); void runSessionOperation(() => fetchSales(`/api/sales/enablement-sessions/${encodeURIComponent(session.id)}/reconcile`, { method: "POST" }), "CloudShare could not verify this Sales Session's status.", "CloudShare Experience status verified and saved.").finally(() => setVerifyingSessionId(null)); }}>{verifyingSessionId === session.id ? "Verifying CloudShare status…" : "Verify CloudShare status"}</button> : null}
            <button type="button" style={compactButtonStyle} onClick={() => { const participantsOpen = participantSessionId !== session.id; setParticipantSessionId(participantsOpen ? session.id : null); onNavigate({ tab: "sessions", sessionView: "manage", sessionId: session.id, sessionStatus: sessionStatusFilter, participantsOpen, accountId: sessionAccountId, opportunityId, preserveScroll: true }); }}>{participantSessionId === session.id ? "Hide participants" : "Manage participants"}</button>
          </div>
          <div style={{ minWidth: 0 }}>
            {editingSessionId === session.id ? <><input aria-label="Session name" value={editedSessionName} onChange={(event) => setEditedSessionName(event.target.value)} style={controlStyle} /><button type="button" style={{ ...compactButtonStyle, marginLeft: "0.5rem" }} onClick={() => void runSessionOperation(() => fetchSales(`/api/sales/enablement-sessions/${encodeURIComponent(session.id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: editedSessionName }) }), "CloudShare could not update this Sales Session.", "Sales Session name updated.", () => setEditingSessionId(null))}>Save edit</button></> : <>{session.sessionName ?? session.type.toUpperCase()} (revision {session.revision ?? 1})</>} · {session.start} to {session.end} ({session.timeZone}) · {session.operation && session.experience ? <>Certalis operation: {session.operation.value}{session.operation.reason ? ` (${session.operation.reason})` : ""} · CloudShare Sales Experience: {session.experience.value} ({session.experience.source === "cloudshare_v4_get_sales" ? `fresh v4 read${session.experience.observedAt ? ` at ${session.experience.observedAt}` : ""}` : "schedule prediction; no fresh provider read"})</> : "Status unavailable"}
            {session.verificationEligible !== true ? <small style={{ color: "#52606d", marginLeft: "0.5rem" }}>CloudShare verification is unavailable while this session is provisioning or needs attention.</small> : null}
          </div>
        </div>
        {participantSessionId === session.id ? <SalesSessionParticipants session={session} fetchSales={fetchSales} onOpenSupport={(id) => onNavigate({ tab: "support", correlationId: id })} /> : null}
      </li>)}</ul>}
      {sessionOperationMessage ? <div role={sessionOperationFailed ? "alert" : "status"} style={sessionOperationFailed ? alertPanelStyle.danger : alertPanelStyle.success}>{sessionOperationMessage}{sessionOperationCorrelationId ? <> <button type="button" onClick={() => onNavigate({ tab: "support", correlationId: sessionOperationCorrelationId })} style={{ border: 0, background: "transparent", color: colors.info, textDecoration: "underline", cursor: "pointer" }}>Open support diagnostics ({sessionOperationCorrelationId})</button></> : null}</div> : null}
    </section> : null}
  </section>;
}

export function SalesSessionParticipants({ session, fetchSales, onOpenSupport }: { readonly session: EnablementSession; readonly fetchSales: typeof fetch; readonly onOpenSupport: (correlationId: string) => void }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [participants, setParticipants] = useState<SalesParticipant[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | null>(null);
  const [operationFailed, setOperationFailed] = useState(false);
  const [monitoringSession, setMonitoringSession] = useState<{ accessWindow: SalesSessionAccessWindow } | null>(null);
  const registerSelectAllRef = useRef<HTMLInputElement>(null);
  const inviteSelectAllRef = useRef<HTMLInputElement>(null);
  // Kept local to this roster; the next render after a per-row operation labels
  // only the selected row through its handler state.
  const refresh = useCallback(async (preserveOperationEvidence = false) => {
    setLoading(true);
    if (!preserveOperationEvidence) setOperationFailed(false);
    try {
      const [recordsResponse, participantsResponse] = await Promise.all([fetchSales("/api/sales/accounts", { cache: "no-store" }), fetchSales(`/api/sales/enablement-sessions/${encodeURIComponent(session.id)}/participants`, { cache: "no-store" })]);
      const recordsBody = await recordsResponse.json() as { contacts?: Contact[]; error?: string };
      const participantsBody = await participantsResponse.json() as { session?: { accessWindow: SalesSessionAccessWindow }; participants?: SalesParticipant[]; error?: string; correlationId?: string };
      if (!recordsResponse.ok || !participantsResponse.ok) { if (!preserveOperationEvidence) setCorrelationId(participantsBody.correlationId ?? null); throw new Error(recordsBody.error ?? participantsBody.error ?? "Could not load Sales Participant monitoring."); }
      setContacts((recordsBody.contacts ?? []).filter((contact) => contact.opportunityId === session.opportunityId && !contact.archivedAt));
      const refreshedParticipants = participantsBody.participants ?? [];
      setParticipants(refreshedParticipants);
      if (participantsBody.session) setMonitoringSession(participantsBody.session);
      setSelectedParticipants((current) => participantsBody.session?.accessWindow.nativeInvitationsAvailable === false ? [] : current.filter((id) => refreshedParticipants.some((participant) => participant.id === id && !participant.needsAttention && participant.participationStatus !== "concluded")));
      if (!preserveOperationEvidence) { setCorrelationId(participantsBody.correlationId ?? null); setMessage(null); setOperationFailed(false); }
    } catch (error) { setOperationFailed(true); if (preserveOperationEvidence) setMessage("Native CloudShare invitations were requested. Participant monitoring could not refresh; investigate the invite evidence before retrying."); else setMessage(error instanceof Error ? error.message : "Could not load Sales Participant monitoring."); } finally { setLoading(false); }
  }, [fetchSales, session.id, session.opportunityId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const register = async () => {
    const eligibleContactIds = availableContacts.map((contact) => contact.id);
    const contactIds = selectedContacts.filter((id) => eligibleContactIds.includes(id));
    if (!nativeInvitationsAvailable || contactIds.length === 0) return;
    setSaving(true); setMessage(null); setCorrelationId(null); setOperationFailed(false);
    try { const response = await fetchSales(`/api/sales/enablement-sessions/${encodeURIComponent(session.id)}/participants`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contactIds }) }); const body = await response.json() as { participants?: SalesParticipant[]; error?: string; correlationId?: string }; if (!response.ok) { setCorrelationId(body.correlationId ?? null); throw new Error(body.error ?? "Could not register selected Sales Participants."); } const returnedParticipants = body.participants ?? []; setParticipants((current) => [...current.filter((existing) => !returnedParticipants.some((value) => value.id === existing.id)), ...returnedParticipants]); setSelectedContacts([]); setCorrelationId(body.correlationId ?? null); setMessage("Sales Participants registered. No native invitations were sent."); } catch (error) { setOperationFailed(true); setMessage(error instanceof Error ? error.message : "Could not register selected Sales Participants."); } finally { setSaving(false); }
  };
  const invite = async () => {
    const participantIds = selectedParticipants.filter((id) => inviteEligibleParticipantIds.includes(id));
    if (participantIds.length === 0) return;
    setSaving(true); setMessage(null); setCorrelationId(null); setOperationFailed(false);
    try {
      const response = await fetchSales(`/api/sales/enablement-sessions/${encodeURIComponent(session.id)}/participants/invite`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantIds }) });
      const body = await response.json() as { error?: string; correlationId?: string; invitationConfirmation?: "confirmed" | "pending"; confirmedParticipantCount?: number; pendingConfirmationParticipantCount?: number };
      if (!response.ok) { setCorrelationId(body.correlationId ?? null); throw new Error(body.error ?? "CloudShare could not send the selected native invitations."); }
      setSelectedParticipants([]);
      setCorrelationId(body.correlationId ?? null);
      setMessage(body.invitationConfirmation === "confirmed"
        ? "CloudShare confirmed native invitations for selected Sales Participants."
        : body.invitationConfirmation === "pending"
          ? "CloudShare accepted the native invitation request, but has not yet confirmed it as sent. Refresh engagement before resending."
          : "Native CloudShare invitations requested for selected Sales Participants. Refresh engagement to confirm their state.");
      await refresh(true);
    } catch (error) { setOperationFailed(true); setMessage(error instanceof Error ? error.message : "CloudShare could not send the selected native invitations."); } finally { setSaving(false); }
  };
  const createLaunchLink = async (participantId: string) => {
    setSaving(true); setMessage(null); setCorrelationId(null); setOperationFailed(false);
    try {
      const response = await fetchSales(`/api/sales/enablement-sessions/${encodeURIComponent(session.id)}/participants/${encodeURIComponent(participantId)}/launch-link`, { method: "POST" });
      const body = await response.json() as { launchUrl?: string; error?: string; correlationId?: string };
      setCorrelationId(body.correlationId ?? null);
      if (!response.ok || !body.launchUrl) throw new Error(body.error ?? "Could not generate a Certalis launch link.");
      const absolute = new URL(body.launchUrl, window.location.origin).toString();
      await navigator.clipboard.writeText(absolute);
      setMessage("Personalised Certalis launch link copied. Any prior link for this participant is now revoked.");
    } catch (error) { setOperationFailed(true); setMessage(error instanceof Error ? error.message : "Could not generate a Certalis launch link."); } finally { setSaving(false); }
  };
  const revokeLaunchLink = async (participantId: string) => {
    setSaving(true); setMessage(null); setCorrelationId(null); setOperationFailed(false);
    try { const response = await fetchSales(`/api/sales/enablement-sessions/${encodeURIComponent(session.id)}/participants/${encodeURIComponent(participantId)}/launch-link`, { method: "DELETE" }); const body = await response.json() as { error?: string; correlationId?: string }; if (!response.ok) { setCorrelationId(body.correlationId ?? null); throw new Error(body.error ?? "Could not revoke the Certalis launch link."); } setCorrelationId(body.correlationId ?? null); setMessage("Personalised Certalis launch link revoked."); } catch (error) { setOperationFailed(true); setMessage(error instanceof Error ? error.message : "Could not revoke the Certalis launch link."); } finally { setSaving(false); }
  };
  const availableContacts = useMemo(() => contacts.filter((contact) => { const participant = participants.find((value) => value.opportunityContactId === contact.id); return !participant || (participant.requiresCorrelationRepair && participant.participationStatus !== "concluded"); }), [contacts, participants]);
  const nativeInvitationsAvailable = monitoringSession?.accessWindow.nativeInvitationsAvailable ?? false;
  const eligibleContactIds = useMemo(() => nativeInvitationsAvailable ? availableContacts.map((contact) => contact.id) : [], [availableContacts, nativeInvitationsAvailable]);
  const inviteEligibleParticipantIds = useMemo(() => nativeInvitationsAvailable ? participants.filter((participant) => !participant.needsAttention && participant.participationStatus !== "concluded").map((participant) => participant.id) : [], [nativeInvitationsAvailable, participants]);
  const selectedEligibleContacts = selectedContacts.filter((id) => eligibleContactIds.includes(id));
  const selectedEligibleParticipants = selectedParticipants.filter((id) => inviteEligibleParticipantIds.includes(id));
  const allContactsSelected = eligibleContactIds.length > 0 && selectedEligibleContacts.length === eligibleContactIds.length;
  const allParticipantsSelected = inviteEligibleParticipantIds.length > 0 && selectedEligibleParticipants.length === inviteEligibleParticipantIds.length;
  useEffect(() => { setSelectedContacts((current) => current.filter((id) => eligibleContactIds.includes(id))); }, [eligibleContactIds]);
  useEffect(() => { setSelectedParticipants((current) => current.filter((id) => inviteEligibleParticipantIds.includes(id))); }, [inviteEligibleParticipantIds]);
  useEffect(() => { if (registerSelectAllRef.current) registerSelectAllRef.current.indeterminate = selectedEligibleContacts.length > 0 && !allContactsSelected; }, [allContactsSelected, selectedEligibleContacts.length]);
  useEffect(() => { if (inviteSelectAllRef.current) inviteSelectAllRef.current.indeterminate = selectedEligibleParticipants.length > 0 && !allParticipantsSelected; }, [allParticipantsSelected, selectedEligibleParticipants.length]);
  return <section aria-label={`Participants for ${session.sessionName ?? session.type.toUpperCase()}`} style={{ ...mutedPanelStyle, marginTop: "0.65rem", display: "grid", gap: "0.75rem" }}>
    <h3 style={{ margin: 0 }}>Sales Participants and engagement</h3><p style={{ margin: 0, color: "#52606d" }}>Register named Opportunity Contacts before access is available. Registration does not send email. Select registered participants to request native CloudShare invitations or resends; no invitation URL is shown in Certalis.</p>
    {loading ? <p>Refreshing CloudShare participant monitoring…</p> : <><fieldset><legend>Register or repair Opportunity Contacts</legend><label style={{ display: "block", fontWeight: 700 }}><input ref={registerSelectAllRef} type="checkbox" aria-label="Select all participants to register or repair" disabled={eligibleContactIds.length === 0} checked={allContactsSelected} onChange={() => setSelectedContacts(allContactsSelected ? [] : eligibleContactIds)} /> Select all</label>{availableContacts.length === 0 ? <p>All active Opportunity Contacts are already registered, or no active Contacts are available.</p> : availableContacts.map((contact) => { const repairable = participants.some((participant) => participant.opportunityContactId === contact.id && participant.requiresCorrelationRepair); return <label key={contact.id} style={{ display: "block" }}><input type="checkbox" aria-label={`${contact.firstName} ${contact.lastName}${repairable ? " (repair CloudShare correlation)" : ""}`} disabled={!nativeInvitationsAvailable} checked={selectedContacts.includes(contact.id)} onChange={() => setSelectedContacts((current) => current.includes(contact.id) ? current.filter((id) => id !== contact.id) : [...current, contact.id])} /> {contact.firstName} {contact.lastName}{repairable ? " (repair CloudShare correlation)" : ""}</label>; })}<button type="button" style={compactButtonStyle} disabled={!nativeInvitationsAvailable || saving || selectedEligibleContacts.length === 0} onClick={() => void register()}>Register or repair selected participants</button></fieldset>
    <fieldset><legend>Registered participant monitoring</legend>{!nativeInvitationsAvailable ? <p>Native invitations are unavailable after this Sales Session has ended.</p> : null}{participants.length === 0 ? <p>No Sales Participants are registered yet.</p> : <table style={{ ...tableStyle, minWidth: "82rem" }}><thead><tr><th style={monitoringSelectCellStyle}><input ref={inviteSelectAllRef} type="checkbox" aria-label="Select all eligible participants for native invite" disabled={inviteEligibleParticipantIds.length === 0} checked={allParticipantsSelected} onChange={() => setSelectedParticipants(allParticipantsSelected ? [] : inviteEligibleParticipantIds)} /></th><th style={monitoringParticipantCellStyle}>Participant</th><th style={cellStyle}>Invite</th><th style={monitoringTimeCellStyle}>Last invite sent</th><th style={monitoringTimeCellStyle}>First joined</th><th style={cellStyle}>Participation</th><th style={cellStyle}>Environment</th><th style={cellStyle}>Instant launch</th></tr></thead><tbody>{participants.map((participant) => { const concluded = participant.participationStatus === "concluded"; const unavailableReason = concluded ? "Unavailable because this Sales Participant has concluded." : !nativeInvitationsAvailable ? "Unavailable because this Sales Session has ended." : undefined; return <tr key={participant.id}><td style={monitoringSelectCellStyle}><input aria-label={`Select ${participant.firstName} ${participant.lastName} for native invite`} title={unavailableReason} type="checkbox" disabled={!nativeInvitationsAvailable || concluded || participant.needsAttention} checked={selectedParticipants.includes(participant.id)} onChange={() => setSelectedParticipants((current) => current.includes(participant.id) ? current.filter((id) => id !== participant.id) : [...current, participant.id])} /></td><td style={monitoringParticipantCellStyle}><strong>{participant.firstName} {participant.lastName}</strong><br /><span>{participant.email}</span>{participant.needsAttention ? <details style={{ marginTop: "0.25rem" }}><summary style={{ color: colors.warning, cursor: "pointer", fontWeight: 700 }}>Needs attention</summary><p style={{ margin: "0.25rem 0 0", color: "#52606d", overflowWrap: "anywhere" }}>{participant.monitoringMessage}</p></details> : null}</td><td style={cellStyle}>{participant.invitationStatus === "sent" ? "Sent" : "Not sent"}</td><td style={monitoringTimeCellStyle}><MonitoringTime value={participant.lastInvitedAt} /></td><td style={monitoringTimeCellStyle}><MonitoringTime value={participant.firstJoined} /></td><td style={cellStyle}>{participant.participationStatus}</td><td style={{ ...cellStyle, whiteSpace: "normal" }}><strong>{participant.environment?.value ?? (participant.environment?.source === "not_assigned" ? "Not assigned" : "Not observed")}</strong><br /><small>CloudShare Environment · {participant.environment?.source ?? "not_observed"}</small>{participant.envStatus ? <><br /><small>Sales roster environment: {participant.envStatus}</small></> : null}</td><td style={{ ...cellStyle, minWidth: "13rem" }}><div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", whiteSpace: "normal" }}><button type="button" title={unavailableReason} disabled={!nativeInvitationsAvailable || concluded || saving || participant.needsAttention} onClick={() => void createLaunchLink(participant.id)}>Copy launch link</button><button type="button" disabled={saving || participant.needsAttention} onClick={() => void revokeLaunchLink(participant.id)}>Revoke link</button><a href={`/sales?tab=support&source=sales-participant-launch&subjectId=${encodeURIComponent(participant.id)}`}>View launch activity</a></div></td></tr>; })}</tbody></table>}<button type="button" style={compactButtonStyle} disabled={!nativeInvitationsAvailable || saving || selectedEligibleParticipants.length === 0} onClick={() => void invite()}>Send or resend native invites</button><button type="button" style={{ ...compactButtonStyle, marginLeft: "0.5rem" }} disabled={saving} onClick={() => void refresh()}>Refresh engagement</button>{correlationId ? <button type="button" aria-label={`Open support diagnostics for latest participant operation (${correlationId})`} onClick={() => onOpenSupport(correlationId)} style={{ ...compactButtonStyle, marginLeft: "0.5rem" }}>Open support diagnostics</button> : null}</fieldset></>}
    {message ? <div role={operationFailed ? "alert" : "status"} style={operationFailed ? alertPanelStyle.danger : alertPanelStyle.success}>{message}{correlationId ? <> <button type="button" onClick={() => onOpenSupport(correlationId)} style={{ border: 0, background: "transparent", color: colors.info, textDecoration: "underline", cursor: "pointer" }}>Open support diagnostics ({correlationId})</button></> : null}</div> : null}
  </section>;
}


function SalesRecordsFeature({ initialSelection, onNavigate }: { readonly initialSelection?: Partial<SalesSelection>; readonly onNavigate: (intent: SalesNavigationIntent) => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasObservedSearchParams = useRef(false);
  const [selection, setSelection] = useState<SalesSelection>(() => ({ accountId: initialSelection?.accountId ?? searchParams.get("accountId"), opportunityId: initialSelection?.opportunityId ?? searchParams.get("opportunityId") }));
  const browserFetch = useCallback<typeof fetch>((input, init) => window.fetch(input, init), []);
  const fetchSales = useMemo(() => createAdminAuthenticatedRequest({ fetchImpl: browserFetch, onSessionExpired: () => { router.replace("/login"); router.refresh(); } }), [browserFetch, router]);
  const [data, setData] = useState<SalesData>(blank);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const dialogOpenerRef = useRef<HTMLElement | null>(null);
  const [filters, setFilters] = useState<{ account: Lifecycle; opportunity: Lifecycle; contact: Lifecycle }>({ account: "active", opportunity: "active", contact: "active" });
  const [sorts, setSorts] = useState<{ account: Sort; opportunity: Sort; contact: Sort }>({ account: "name", opportunity: "name", contact: "name" });

  useEffect(() => {
    if (!hasObservedSearchParams.current) { hasObservedSearchParams.current = true; return; }
    setSelection({ accountId: searchParams.get("accountId"), opportunityId: searchParams.get("opportunityId") });
  }, [searchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchSales("/api/sales/accounts", { cache: "no-store" });
      const body = await response.json() as SalesData & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not load Sales records.");
      setData(body);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load Sales records.");
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, [fetchSales]);
  useEffect(() => { void load(); }, [load]);

  const updateSelection = useCallback((accountId: string | null, opportunityId: string | null) => {
    setSelection({ accountId, opportunityId });
    onNavigate({ tab: "records", accountId, opportunityId, preserveScroll: true });
  }, [onNavigate]);
  const openDialog = useCallback((nextDialog: Exclude<Dialog, null>, opener: HTMLElement) => { dialogOpenerRef.current = opener; setDialog(nextDialog); }, []);
  const closeDialog = useCallback(() => { setDialog(null); }, []);
  const mutate = useCallback(async (url: string, method: "POST" | "PATCH", payload?: Record<string, unknown>) => {
    setLoading(true);
    try {
      const response = await fetchSales(url, { method, headers: payload ? { "content-type": "application/json" } : undefined, body: payload ? JSON.stringify(payload) : undefined });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not save Sales record.");
      await load();
      setMessage("Saved.");
      setDialog(null);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save Sales record.");
      return false;
    } finally {
      setLoading(false);
    }
  }, [fetchSales, load]);

  const matchesSearch = useCallback((values: string[]) => !search.trim() || values.join(" ").toLowerCase().includes(search.trim().toLowerCase()), [search]);
  const selectedAccount = data.accounts.find((record) => record.id === selection.accountId) ?? null;
  const selectedOpportunity = selectedAccount ? data.opportunities.find((record) => record.id === selection.opportunityId && record.accountId === selectedAccount.id) ?? null : null;
  const visibleAccounts = visible(data.accounts, filters.account, sorts.account, (record) => record.name);
  const visibleOpportunities = visible(data.opportunities.filter((record) => record.accountId === selectedAccount?.id), filters.opportunity, sorts.opportunity, (record) => record.name);
  const visibleContacts = visible(data.contacts.filter((record) => record.opportunityId === selectedOpportunity?.id), filters.contact, sorts.contact, (record) => `${record.lastName} ${record.firstName}`);
  const accounts = visibleAccounts.filter((record) => matchesSearch([record.name]));
  const opportunities = visibleOpportunities.filter((record) => matchesSearch([record.name]));
  const contacts = visibleContacts.filter((record) => matchesSearch([record.firstName, record.lastName, record.email]));

  useEffect(() => {
    if (!hasLoaded) return;
    if (selection.accountId && !selectedAccount) { updateSelection(null, null); return; }
    if (selection.opportunityId && !selectedOpportunity) updateSelection(selectedAccount?.id ?? null, null);
  }, [hasLoaded, selectedAccount, selectedOpportunity, selection.accountId, selection.opportunityId, updateSelection]);
  useEffect(() => {
    setFilters((current) => ({
      ...current,
      account: selectedAccount?.archivedAt && current.account === "active" ? "archived" : current.account,
      opportunity: selectedOpportunity?.archivedAt && current.opportunity === "active" ? "archived" : current.opportunity,
    }));
  }, [selectedAccount?.archivedAt, selectedOpportunity?.archivedAt]);

  const selectWithKeyboard = (event: React.KeyboardEvent<HTMLTableRowElement>, select: () => void) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); }
  };
  const opportunityDisabled = !selectedAccount || Boolean(selectedAccount.archivedAt);
  const opportunityInstruction = selectedAccount?.archivedAt ? "Archived Accounts cannot receive Opportunities." : undefined;
  const contactDisabled = !selectedOpportunity || Boolean(selectedOpportunity.archivedAt);
  const contactInstruction = selectedOpportunity?.archivedAt ? "Archived Opportunities cannot receive Contacts." : undefined;

  return <section aria-label="Accounts and opportunities">
    <section style={{ ...mutedPanelStyle, display: "flex", gap: "0.75rem", alignItems: "end", flexWrap: "wrap" }} aria-label="Sales workspace controls">
      <label style={{ display: "grid", gap: "0.3rem", flex: "1 1 22rem" }}>Search current view<input aria-label="Search current view" value={search} onChange={(event) => setSearch(event.target.value)} style={controlStyle} placeholder="Account, opportunity, or contact" /></label>
      <span style={{ color: "#52606d", fontSize: "0.9rem" }}>Select an Account, then an Opportunity, to work down the relationship.</span>
      {message ? <span role="status">{message}</span> : null}
    </section>
    <div style={{ display: "grid", gap: "1rem", marginTop: "1rem" }}>
      <RecordGrid title="Accounts" columns={["36%", "14%", "20%", "18%", "12%"]} count={accounts.length} lifecycle={filters.account} sort={sorts.account} onLifecycle={(value) => setFilters((current) => ({ ...current, account: value }))} onSort={(value) => setSorts((current) => ({ ...current, account: value }))} addLabel="New Account" onAdd={(event) => openDialog({ kind: "account" }, event.currentTarget)}>
        <thead><tr><th style={cellStyle}>Account</th><th style={cellStyle}>Type</th><th style={cellStyle}>Created (UTC)</th><th style={cellStyle}>Archived (UTC)</th><th style={actionCellStyle}>Actions</th></tr></thead>
        <tbody>{accounts.map((record) => <tr key={record.id} aria-selected={record.id === selectedAccount?.id} tabIndex={0} onClick={() => updateSelection(record.id, null)} onKeyDown={(event) => selectWithKeyboard(event, () => updateSelection(record.id, null))} style={{ ...selectableRowStyle, ...(record.id === selectedAccount?.id ? selectedRowStyle : {}) }}><td style={cellStyle} title={record.name}><strong>{record.name}</strong></td><td style={cellStyle}>{labelAccountKind(record.kind)}</td><td style={cellStyle}>{formatUtc(record.createdAt)}</td><td style={cellStyle}>{formatUtc(record.archivedAt)}</td><td style={actionCellStyle}><RowActions recordName={record.name} onEdit={(event) => openDialog({ kind: "account", record }, event.currentTarget)} archived={Boolean(record.archivedAt)} loading={loading} onArchive={() => void mutate(`/api/sales/accounts/${record.id}/archive`, "POST")} /></td></tr>)}</tbody>
      </RecordGrid>
      <RecordGrid title="Opportunities" columns={["36%", "14%", "20%", "18%", "12%"]} context={selectedAccount ? <>Selected Account: <strong>{selectedAccount.name}</strong></> : "Select an Account to view its Opportunities."} count={opportunities.length} lifecycle={filters.opportunity} sort={sorts.opportunity} onLifecycle={(value) => setFilters((current) => ({ ...current, opportunity: value }))} onSort={(value) => setSorts((current) => ({ ...current, opportunity: value }))} addLabel="New Opportunity" disabled={opportunityDisabled} addInstruction={opportunityInstruction} onAdd={(event) => openDialog({ kind: "opportunity" }, event.currentTarget)}>
        <thead><tr><th style={cellStyle}>Opportunity</th><th style={cellStyle}>Status</th><th style={cellStyle}>Created (UTC)</th><th style={cellStyle}>Archived (UTC)</th><th style={actionCellStyle}>Actions</th></tr></thead>
        <tbody>{opportunities.map((record) => <tr key={record.id} aria-selected={record.id === selectedOpportunity?.id} tabIndex={0} onClick={() => updateSelection(record.accountId, record.id)} onKeyDown={(event) => selectWithKeyboard(event, () => updateSelection(record.accountId, record.id))} style={{ ...selectableRowStyle, ...(record.id === selectedOpportunity?.id ? selectedRowStyle : {}) }}><td style={cellStyle} title={record.name}><strong>{record.name}</strong></td><td style={cellStyle}>{labelStatus(record.status)}</td><td style={cellStyle}>{formatUtc(record.createdAt)}</td><td style={cellStyle}>{formatUtc(record.archivedAt)}</td><td style={actionCellStyle}><RowActions recordName={record.name} onEdit={(event) => openDialog({ kind: "opportunity", record }, event.currentTarget)} archived={Boolean(record.archivedAt)} loading={loading} onArchive={() => void mutate(`/api/sales/opportunities/${record.id}/archive`, "POST")} /></td></tr>)}</tbody>
      </RecordGrid>
      <RecordGrid title="Opportunity Contacts" columns={["30%", "24%", "20%", "14%", "12%"]} context={selectedOpportunity ? <>Selected Opportunity: <strong>{selectedOpportunity.name}</strong></> : "Select an Opportunity to view its Contacts."} count={contacts.length} lifecycle={filters.contact} sort={sorts.contact} onLifecycle={(value) => setFilters((current) => ({ ...current, contact: value }))} onSort={(value) => setSorts((current) => ({ ...current, contact: value }))} addLabel="New Contact" disabled={contactDisabled} addInstruction={contactInstruction} onAdd={(event) => openDialog({ kind: "contact" }, event.currentTarget)}>
        <thead><tr><th style={cellStyle}>Contact</th><th style={cellStyle}>Email</th><th style={cellStyle}>Created (UTC)</th><th style={cellStyle}>Archived (UTC)</th><th style={actionCellStyle}>Actions</th></tr></thead>
        <tbody>{contacts.map((record) => <tr key={record.id} style={selectableRowStyle}><td style={cellStyle} title={`${record.firstName} ${record.lastName}`}><strong>{record.firstName} {record.lastName}</strong></td><td style={cellStyle} title={record.email}>{record.email}</td><td style={cellStyle}>{formatUtc(record.createdAt)}</td><td style={cellStyle}>{formatUtc(record.archivedAt)}</td><td style={actionCellStyle}><RowActions recordName={`${record.firstName} ${record.lastName}`} onEdit={(event) => openDialog({ kind: "contact", record }, event.currentTarget)} archived={Boolean(record.archivedAt)} loading={loading} onArchive={() => void mutate(`/api/sales/contacts/${record.id}/archive`, "POST")} /></td></tr>)}</tbody>
      </RecordGrid>
    </div>
    {dialog ? <RecordDialog dialog={dialog} opener={dialogOpenerRef.current} selectedAccount={selectedAccount} selectedOpportunity={selectedOpportunity} accounts={data.accounts} opportunities={data.opportunities} loading={loading} onClose={closeDialog} onSave={mutate} /> : null}
  </section>;
}

function ItemCatalog({ fetchAdmin, view, focusedItemId, onNavigate }: { readonly fetchAdmin: typeof fetch; readonly view: SalesItemView; readonly focusedItemId?: string; readonly onNavigate: (intent: SalesNavigationIntent) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [archived, setArchived] = useState<Item[]>([]);
  const [projects, setProjects] = useState<Named[]>([]);
  const [regions, setRegions] = useState<Named[]>([]);
  const [blueprints, setBlueprints] = useState<BlueprintOption[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [projectId, setProjectId] = useState("");
  const [blueprintIds, setBlueprintIds] = useState<string[]>([]);
  const [policyId, setPolicyId] = useState("");
  const [regionIds, setRegionIds] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [inspected, setInspected] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCorrelationId, setErrorCorrelationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const selectedPolicy = policies.find((policy) => policy.id === policyId);
  const eligibleRegionIds = useMemo(() => {
    const selected = blueprintIds.map((id) => blueprints.find((blueprint) => blueprint.id === id)?.defaultSnapshotRegionIds ?? []);
    return selected.length ? selected.reduce((shared, ids) => shared.filter((id) => ids.includes(id))) : [];
  }, [blueprintIds, blueprints]);
  const eligibleRegions = regions.filter((region) => eligibleRegionIds.includes(region.id));
  useEffect(() => setRegionIds((current) => current.filter((id) => eligibleRegionIds.includes(id))), [eligibleRegionIds]);

  const loadItems = useCallback(async () => {
    const response = await fetchAdmin("/api/sales/items");
    const body = await response.json() as { activeItems?: Item[]; archivedItems?: Item[]; error?: string };
    if (!response.ok) throw new Error(body.error ?? "Failed to load Items");
    setItems(body.activeItems ?? []);
    setArchived(body.archivedItems ?? []);
  }, [fetchAdmin]);
  const loadBootstrap = useCallback(async () => {
    setLoading(true); setError(null); setErrorCorrelationId(null);
    try {
      const response = await fetchAdmin("/api/sales/item-authoring?refresh=true");
      const body = await response.json() as { projects?: Named[]; regions?: Named[]; error?: string; correlationId?: string | null };
      if (!response.ok) { setError(body.error ?? "Failed to load CloudShare resources"); setErrorCorrelationId(body.correlationId ?? null); return; }
      setProjects(body.projects ?? []); setRegions(body.regions ?? []);
    } finally { setLoading(false); }
  }, [fetchAdmin]);
  useEffect(() => { void loadItems().catch((caught) => setError(caught instanceof Error ? caught.message : "Failed to load Items")); }, [loadItems]);
  useEffect(() => {
    if (view === "create") void loadBootstrap();
  }, [loadBootstrap, view]);
  const selectProject = useCallback(async (next: string) => {
    setProjectId(next); setBlueprintIds([]); setRegionIds([]); setPolicyId(""); setBlueprints([]); setPolicies([]);
    if (!next) return;
    setLoading(true); setError(null); setErrorCorrelationId(null);
    try {
      const response = await fetchAdmin(`/api/sales/item-authoring/projects/${encodeURIComponent(next)}?refresh=true`);
      const body = await response.json() as { blueprints?: BlueprintOption[]; policies?: Policy[]; error?: string; correlationId?: string | null };
      if (!response.ok) { setError(body.error ?? "Failed to load Project resources"); setErrorCorrelationId(body.correlationId ?? null); return; }
      setBlueprints(body.blueprints ?? []); setPolicies(body.policies ?? []);
    } finally { setLoading(false); }
  }, [fetchAdmin]);
  const save = async () => {
    setLoading(true); setError(null); setErrorCorrelationId(null);
    try {
      const response = await fetchAdmin(editingId ? `/api/sales/items/${encodeURIComponent(editingId)}` : "/api/sales/items", { method: editingId ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, description, projectId, blueprintIds, policyId, regionIds }) });
      const body = await response.json() as { error?: string; correlationId?: string | null };
      if (!response.ok) { setError(body.error ?? "Unable to save Item"); setErrorCorrelationId(body.correlationId ?? null); return; }
      setName(""); setDescription(""); setBlueprintIds([]); setRegionIds([]); setEditingId(null); await loadItems(); onNavigate({ tab: "items", itemView: "catalog" });
    } finally { setLoading(false); }
  };
  const cancelAuthoring = () => {
    setName(""); setDescription(""); setProjectId(""); setBlueprintIds([]); setPolicyId(""); setRegionIds([]); setEditingId(null); setError(null); setErrorCorrelationId(null);
    onNavigate({ tab: "items", itemView: "catalog" });
  };
  const inspect = useCallback(async (id: string) => {
    const response = await fetchAdmin(`/api/sales/items/${encodeURIComponent(id)}`);
    const body = await response.json() as { item?: Item; error?: string; correlationId?: string | null };
    if (!response.ok) { setError(body.error ?? "Unable to inspect Item"); setErrorCorrelationId(body.correlationId ?? null); return; }
    setInspected(body.item ?? null);
  }, [fetchAdmin]);
  const edit = useCallback(async (item: Item) => {
    await loadBootstrap(); await selectProject(item.project.id);
    setEditingId(item.id); setName(item.name); setDescription(item.description); setBlueprintIds(item.blueprints.map((blueprint) => blueprint.id)); setPolicyId(item.policy.id); setRegionIds(item.regions.map((region) => region.id));
  }, [loadBootstrap, selectProject]);
  const archive = async (id: string) => {
    setError(null); setErrorCorrelationId(null);
    const response = await fetchAdmin(`/api/sales/items/${encodeURIComponent(id)}/archive`, { method: "POST" });
    const body = await response.json() as { error?: string; correlationId?: string | null };
    if (!response.ok) { setError(body.error ?? "Unable to archive Item"); setErrorCorrelationId(body.correlationId ?? null); return; }
    await loadItems(); onNavigate({ tab: "items", itemView: "catalog" });
  };

  useEffect(() => {
    if (view === "detail" && focusedItemId) void inspect(focusedItemId);
  }, [focusedItemId, inspect, view]);
  useEffect(() => {
    if (view !== "edit" || !focusedItemId) return;
    const item = items.find((candidate) => candidate.id === focusedItemId);
    if (item) void edit(item);
  }, [edit, focusedItemId, items, view]);

  return <section style={{ display: "grid", gap: "1rem", marginTop: "1rem" }} aria-label="Item catalogue">
    {view === "catalog" ? <><section style={{ ...mutedPanelStyle, display: "grid", gap: "0.75rem" }}><h2 style={{ margin: 0 }}>Item catalogue</h2><p style={{ margin: 0 }}>Choose a reusable, archive-only Item. The Sales Experience type is chosen when creating an Enablement Session, so this Item can support more than one delivery purpose.</p><div><button type="button" style={primaryButtonStyle} onClick={() => onNavigate({ tab: "items", itemView: "create" })}>Create Item</button></div></section><section aria-label="Active Items" style={{ ...cardStyle, padding: "1.1rem" }}><h2 style={{ margin: 0 }}>Active Items</h2>{items.length === 0 ? <p>No active Items yet.</p> : <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>{items.map((item) => <article key={item.id} style={{ border: "1px solid #d6dbe3", borderRadius: "8px", padding: "0.9rem" }}><strong>{item.name}</strong><p style={{ margin: "0.35rem 0" }}>{item.blueprints.map((blueprint) => blueprint.name).join(" → ")} · {item.policy.name} · {item.regions.map((region) => region.name).join(", ")}</p><p style={{ margin: "0.35rem 0" }}>{item.defaultDurationMinutes} min</p><button type="button" style={compactButtonStyle} onClick={() => onNavigate({ tab: "items", itemView: "detail", itemId: item.id })}>View details</button></article>)}</div>}</section><section aria-label="Archived Items" style={{ ...mutedPanelStyle }}><h2 style={{ margin: 0 }}>Archived history</h2>{archived.length === 0 ? <p>No archived Items yet.</p> : <ul>{archived.map((item) => <li key={item.id}>{item.name} (archived; cannot start an Enablement Session)</li>)}</ul>}</section></> : null}
    {view === "create" || view === "edit" ? <>
      <style>{`
        .item-authoring-shell { max-width: 66rem; }
        .item-authoring-form { display: grid; gap: 1.5rem; }
        .item-authoring-header { display: grid; gap: 0.5rem; }
        .item-authoring-header p { margin: 0; color: ${colors.textSecondary}; line-height: 1.5; }
        .item-authoring-fields { display: grid; gap: 1rem; }
        .item-authoring-field { display: grid; grid-template-columns: minmax(9rem, 11rem) minmax(0, 1fr); gap: 1rem; align-items: start; }
        .item-authoring-label { color: ${colors.textPrimary}; font-weight: 600; line-height: 1.45; padding-top: 0.7rem; }
        .item-authoring-control { width: 100%; min-width: 0; min-height: 2.7rem; box-sizing: border-box; padding: 0.65rem 0.75rem; border: 1px solid ${colors.borderStrong}; border-radius: 6px; background: ${colors.surface}; color: ${colors.textPrimary}; font: inherit; line-height: 1.35; }
        .item-authoring-control:focus { outline: 3px solid ${colors.accentSoft}; outline-offset: 1px; border-color: ${colors.accent}; }
        .item-authoring-control--textarea { min-height: 7rem; resize: vertical; }
        .item-resource-set { display: grid; gap: 1rem; margin: 0; padding: 1rem; border: 1px solid ${colors.border}; border-radius: 8px; background: ${colors.surface}; }
        .item-resource-set legend { padding: 0 0.35rem; color: ${colors.textPrimary}; font-weight: 700; }
        .item-blueprint-set { display: grid; gap: 0.6rem; margin: 0; padding: 0.85rem 1rem; border: 1px solid ${colors.border}; border-radius: 6px; background: ${colors.surfaceMuted}; }
        .item-blueprint-set legend { padding: 0 0.25rem; font-weight: 600; }
        .item-blueprint-options { display: grid; gap: 0.55rem; }
        .item-blueprint-option { display: flex; align-items: center; gap: 0.6rem; min-height: 1.5rem; line-height: 1.35; }
        .item-blueprint-empty, .item-policy-help { margin: 0; color: ${colors.textMuted}; font-size: 0.9rem; line-height: 1.45; }
        .item-authoring-actions { display: flex; align-items: center; gap: 0.75rem; padding-top: 0.25rem; }
        @media (max-width: 640px) { .item-authoring-field { grid-template-columns: 1fr; gap: 0.45rem; } .item-authoring-label { padding-top: 0; } .item-resource-set { padding: 0.85rem; } }
      `}</style>
      <section aria-label="Item authoring" className="item-authoring-shell" style={{ ...mutedPanelStyle, padding: "clamp(1.1rem, 3vw, 1.75rem)" }}>
        <form aria-label="Item authoring form" className="item-authoring-form" onSubmit={(event) => event.preventDefault()}>
          <div className="item-authoring-header">
            <div><button type="button" style={compactButtonStyle} onClick={cancelAuthoring} disabled={loading}>Back to catalogue</button><h2 style={{ margin: "0.85rem 0 0" }}>{view === "edit" ? "Edit Item" : "Create Item"}</h2></div>
            <p>Select live CloudShare resources by friendly name. Selected Blueprint order becomes the future step order.</p>
          </div>
          <div className="item-authoring-fields">
            <div className="item-authoring-field"><label className="item-authoring-label" htmlFor="item-name">Name</label><input id="item-name" className="item-authoring-control" aria-label="Item name" value={name} onChange={(event) => setName(event.target.value)} /></div>
            <div className="item-authoring-field"><label className="item-authoring-label" htmlFor="item-description">Description</label><textarea id="item-description" className="item-authoring-control item-authoring-control--textarea" rows={4} value={description} onChange={(event) => setDescription(event.target.value)} /></div>
            <fieldset className="item-resource-set"><legend>Live CloudShare resources</legend>
              <div className="item-authoring-field"><label className="item-authoring-label" htmlFor="item-project">Project</label><div style={{ display: "grid", gap: "0.45rem", minWidth: 0 }}><select id="item-project" className="item-authoring-control" aria-label="Project" value={projectId} disabled={loading} onChange={(event) => void selectProject(event.target.value)}><option value="">Select a Project</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}><button type="button" style={compactButtonStyle} disabled={!projectId || loading} onClick={() => void selectProject(projectId)}>Refresh live resources</button><span className="item-policy-help">Refresh after CloudShare changes. Reconfirm Blueprint steps, Policy, and Regions.</span></div></div></div>
              <fieldset className="item-blueprint-set"><legend>Blueprint steps</legend>{loading ? <p className="item-blueprint-empty">Loading Blueprints for this Project…</p> : !projectId ? <p className="item-blueprint-empty">Choose a Project to see its Blueprints.</p> : blueprints.length === 0 ? <p className="item-blueprint-empty">No Blueprints are available for this Project.</p> : <div className="item-blueprint-options">{blueprints.map((item) => { const step = blueprintIds.indexOf(item.id); return <label key={item.id} className="item-blueprint-option"><input type="checkbox" checked={step >= 0} onChange={() => setBlueprintIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /> <span>{step >= 0 ? <strong>Step {step + 1}: </strong> : null}{item.name}</span></label>; })}</div>}<p className="item-policy-help">Removing a Blueprint immediately reindexes the remaining steps.</p></fieldset>
              <div className="item-authoring-field"><label className="item-authoring-label" htmlFor="item-policy">Policy</label><div style={{ display: "grid", gap: "0.45rem", minWidth: 0 }}><select id="item-policy" className="item-authoring-control" aria-label="Policy" value={policyId} onChange={(event) => setPolicyId(event.target.value)}><option value="">Select a Policy</option>{policies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><p className="item-policy-help">{selectedPolicy?.storageLeaseMinutes ? `Default duration: ${selectedPolicy.storageLeaseMinutes} minutes (Policy storage lease)` : "Choose a Policy with a storage lease."}</p></div></div>
              <div className="item-authoring-field"><span className="item-authoring-label">Eligible Regions</span><div className="item-blueprint-options" role="group" aria-label="Eligible Regions">{blueprintIds.length === 0 ? <p className="item-policy-help">Select Blueprint steps to calculate eligible Regions.</p> : eligibleRegions.length === 0 ? <p className="item-policy-help">These Blueprint steps have no shared default-Snapshot Region and cannot be saved together.</p> : eligibleRegions.map((region) => <label key={region.id} className="item-blueprint-option"><input type="checkbox" checked={regionIds.includes(region.id)} onChange={() => setRegionIds((current) => current.includes(region.id) ? current.filter((id) => id !== region.id) : [...current, region.id])} /> <span>{region.friendlyName ?? region.name}</span></label>)}<p className="item-policy-help">Every selected Region must have the default Snapshot for every selected Blueprint.</p></div></div>
            </fieldset>
          </div>
          <div className="item-authoring-actions"><button type="button" style={compactButtonStyle} onClick={cancelAuthoring} disabled={loading}>Cancel</button><button type="button" style={primaryButtonStyle} onClick={() => void save()} disabled={loading}>{view === "edit" ? "Save Item changes" : "Save Item"}</button></div>
          {error ? <ItemFailureAlert message={error} correlationId={errorCorrelationId} onDismiss={() => { setError(null); setErrorCorrelationId(null); }} onOpenSupport={() => errorCorrelationId && onNavigate({ tab: "support", correlationId: errorCorrelationId })} /> : null}
        </form>
      </section>
    </> : null}
    {view === "detail" ? <section aria-label="Item inspection" style={{ ...mutedPanelStyle, display: "grid", gap: "0.75rem" }}><button type="button" style={compactButtonStyle} onClick={() => onNavigate({ tab: "items", itemView: "catalog" })}>Back to catalogue</button>{inspected ? <><h2 style={{ margin: 0 }}>{inspected.name}</h2><p style={{ margin: 0 }}>{inspected.description}</p><p style={{ margin: 0 }}>{inspected.blueprints.map((blueprint) => blueprint.name).join(" → ")} · {inspected.policy.name} · {inspected.regions.map((region) => region.name).join(", ")} · {inspected.defaultDurationMinutes} min</p><div style={{ display: "flex", gap: "0.5rem" }}><button type="button" style={compactButtonStyle} onClick={() => onNavigate({ tab: "items", itemView: "edit", itemId: inspected.id })}>Edit</button><button type="button" style={dangerButtonStyle} onClick={() => void archive(inspected.id)}>Archive</button></div></> : <p>Loading Item details…</p>}{error ? <ItemFailureAlert message={error} correlationId={errorCorrelationId} onDismiss={() => { setError(null); setErrorCorrelationId(null); }} onOpenSupport={() => errorCorrelationId && onNavigate({ tab: "support", correlationId: errorCorrelationId })} /> : null}</section> : null}
  </section>;
}

function ItemFailureAlert({ message, correlationId, onDismiss, onOpenSupport }: { readonly message: string; readonly correlationId: string | null; readonly onDismiss: () => void; readonly onOpenSupport: () => void }) {
  return <div role="alert" style={{ ...alertPanelStyle.danger, display: "grid", gap: "0.5rem" }}><div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start" }}><p style={{ margin: 0 }}>{message}</p><button type="button" onClick={onDismiss} style={{ padding: "0.25rem 0.55rem" }}>Dismiss</button></div>{correlationId ? <p style={{ margin: 0, fontSize: "0.85rem" }}>Open <strong>Support Diagnostics</strong> filtered by correlation ID <button type="button" onClick={onOpenSupport} style={{ color: colors.info, fontFamily: "monospace", fontWeight: 700, overflowWrap: "anywhere", border: 0, padding: 0, background: "transparent", cursor: "pointer" }}>{correlationId}</button>.</p> : null}</div>;
}

function RecordGrid({ title, columns, context, count, lifecycle, sort, onLifecycle, onSort, addLabel, disabled, addInstruction, onAdd, children }: { title: string; columns: readonly string[]; context?: React.ReactNode; count: number; lifecycle: Lifecycle; sort: Sort; onLifecycle: (value: Lifecycle) => void; onSort: (value: Sort) => void; addLabel: string; disabled?: boolean; addInstruction?: string; onAdd: (event: React.MouseEvent<HTMLButtonElement>) => void; children: React.ReactNode }) {
  return <section style={{ ...cardStyle, padding: "1.1rem" }} aria-label={title}>
    <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.8rem" }}>
      <div><h2 style={{ margin: 0 }}>{title}</h2><p style={{ margin: "0.25rem 0 0", color: "#52606d" }}>{context ?? `${count} record${count === 1 ? "" : "s"} shown`}</p></div>
      <div style={{ display: "flex", alignItems: "end", gap: "0.5rem", flexWrap: "wrap" }}>
        <label style={{ display: "grid", gap: "0.2rem", fontSize: "0.85rem" }}>View<select aria-label={`${title} lifecycle`} value={lifecycle} onChange={(event) => onLifecycle(event.target.value as Lifecycle)} style={controlStyle}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></select></label>
        <label style={{ display: "grid", gap: "0.2rem", fontSize: "0.85rem" }}>Sort<select aria-label={`${title} sort`} value={sort} onChange={(event) => onSort(event.target.value as Sort)} style={controlStyle}><option value="name">Name</option><option value="created">Created date</option></select></label>
        <button type="button" style={disabled ? { ...primaryButtonStyle, ...disabledButtonStyle } : primaryButtonStyle} disabled={disabled} title={addInstruction} onClick={onAdd}>{addLabel}</button>
      </div>
    </div>
    <div style={{ overflowX: "auto" }}><table style={tableStyle}><colgroup>{columns.map((width) => <col key={`${title}-${width}`} style={{ width }} />)}</colgroup>{children}</table></div>
    <p style={{ color: "#52606d", fontSize: "0.85rem", margin: "0.7rem 0 0" }}>Showing {count} record{count === 1 ? "" : "s"}</p>
  </section>;
}

function RowActions({ recordName, onEdit, archived, loading, onArchive }: { recordName: string; onEdit: (event: React.MouseEvent<HTMLButtonElement>) => void; archived: boolean; loading: boolean; onArchive: () => void }) {
  return <div style={{ display: "flex", justifyContent: "end", gap: "0.4rem", flexWrap: "nowrap" }}><button type="button" aria-label={`Edit ${recordName}`} style={{ ...compactButtonStyle, width: "3.8rem", paddingInline: "0.5rem" }} disabled={loading} onClick={(event) => { event.stopPropagation(); onEdit(event); }}>Edit</button>{!archived ? <button type="button" aria-label={`Archive ${recordName}`} style={{ ...dangerButtonStyle, width: "4.7rem", paddingInline: "0.5rem", fontSize: "0.85rem" }} disabled={loading} onClick={(event) => { event.stopPropagation(); onArchive(); }}>Archive</button> : <span style={{ color: "#52606d", width: "4.7rem", textAlign: "center" }}>Archived</span>}</div>;
}

function RecordDialog({ dialog, opener, selectedAccount, selectedOpportunity, accounts, opportunities, loading, onClose, onSave }: { dialog: Exclude<Dialog, null>; opener: HTMLElement | null; selectedAccount: Account | null; selectedOpportunity: Opportunity | null; accounts: Account[]; opportunities: Opportunity[]; loading: boolean; onClose: () => void; onSave: (url: string, method: "POST" | "PATCH", payload?: Record<string, unknown>) => Promise<boolean> }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef<HTMLInputElement>(null);
  const accountRecord = dialog.kind === "account" ? dialog.record : undefined;
  const opportunityRecord = dialog.kind === "opportunity" ? dialog.record : undefined;
  const contactRecord = dialog.kind === "contact" ? dialog.record : undefined;
  const isEdit = Boolean(dialog.record);
  const [name, setName] = useState(accountRecord?.name ?? opportunityRecord?.name ?? "");
  const [kind, setKind] = useState<Account["kind"]>(accountRecord?.kind ?? "prospect");
  const [status, setStatus] = useState<Opportunity["status"]>(opportunityRecord?.status ?? "open");
  const [accountId, setAccountId] = useState(opportunityRecord?.accountId ?? selectedAccount?.id ?? "");
  const [opportunityId, setOpportunityId] = useState(contactRecord?.opportunityId ?? selectedOpportunity?.id ?? "");
  const [firstName, setFirstName] = useState(contactRecord?.firstName ?? "");
  const [lastName, setLastName] = useState(contactRecord?.lastName ?? "");
  const [email, setEmail] = useState(contactRecord?.email ?? "");
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (dialog.kind === "account") void onSave(accountRecord ? `/api/sales/accounts/${accountRecord.id}` : "/api/sales/accounts", accountRecord ? "PATCH" : "POST", { name, kind });
    if (dialog.kind === "opportunity") void onSave(opportunityRecord ? `/api/sales/opportunities/${opportunityRecord.id}` : "/api/sales/opportunities", opportunityRecord ? "PATCH" : "POST", { accountId, name, status });
    if (dialog.kind === "contact") void onSave(contactRecord ? `/api/sales/contacts/${contactRecord.id}` : "/api/sales/contacts", contactRecord ? "PATCH" : "POST", { opportunityId, firstName, lastName, email });
  };
  const title = `${isEdit ? "Edit" : "New"} ${dialog.kind === "contact" ? "Contact" : dialog.kind[0].toUpperCase() + dialog.kind.slice(1)}`;
  useEffect(() => {
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled])") ?? []);
    initialFocusRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (!elements.length) { event.preventDefault(); return; }
      const first = elements[0]; const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => { document.removeEventListener("keydown", handleKeyDown); opener?.focus(); };
  }, [onClose, opener]);
  return <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.45)", display: "grid", placeItems: "center", zIndex: 20, padding: "1.5rem" }}><form onSubmit={submit} style={{ ...cardStyle, width: "min(52rem, 100%)", padding: "1.75rem", display: "grid", gap: "1.25rem", boxShadow: "0 20px 45px rgba(15, 23, 42, 0.25)" }}><div><h2 style={{ margin: 0 }}>{title}</h2><p style={{ margin: "0.35rem 0 0", color: "#52606d" }}>Changes are kept locally for this Customer and leave audit and diagnostic evidence.</p></div><div style={{ display: "grid", gridTemplateColumns: "minmax(9rem, 12rem) minmax(0, 1fr)", gap: "1rem 1.25rem", alignItems: "center" }}>{dialog.kind === "account" ? <><DialogField label="Account name" htmlFor="sales-account-name"><input id="sales-account-name" ref={initialFocusRef} required value={name} onChange={(event) => setName(event.target.value)} style={fullControlStyle} /></DialogField><DialogField label="Account type" htmlFor="sales-account-kind"><select id="sales-account-kind" value={kind} onChange={(event) => setKind(event.target.value as Account["kind"])} style={fullControlStyle}><option value="prospect">Prospect</option><option value="current_customer">Current customer</option></select></DialogField></> : null}{dialog.kind === "opportunity" ? <><DialogField label={isEdit ? "Account" : "Selected Account"} htmlFor={isEdit ? "sales-opportunity-account" : undefined}>{isEdit ? <select id="sales-opportunity-account" required value={accountId} onChange={(event) => setAccountId(event.target.value)} style={fullControlStyle}>{accounts.filter((account) => !account.archivedAt || account.id === accountId).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select> : <ContextValue value={selectedAccount?.name ?? "Selected Account"} />}</DialogField><DialogField label="Opportunity name" htmlFor="sales-opportunity-name"><input id="sales-opportunity-name" ref={initialFocusRef} required value={name} onChange={(event) => setName(event.target.value)} style={fullControlStyle} /></DialogField><DialogField label="Status" htmlFor="sales-opportunity-status"><select id="sales-opportunity-status" value={status} onChange={(event) => setStatus(event.target.value as Opportunity["status"])} style={fullControlStyle}><option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option></select></DialogField></> : null}{dialog.kind === "contact" ? <><DialogField label={isEdit ? "Opportunity" : "Selected Opportunity"} htmlFor={isEdit ? "sales-contact-opportunity" : undefined}>{isEdit ? <select id="sales-contact-opportunity" required value={opportunityId} onChange={(event) => setOpportunityId(event.target.value)} style={fullControlStyle}>{opportunities.filter((opportunity) => !opportunity.archivedAt || opportunity.id === opportunityId).map((opportunity) => <option key={opportunity.id} value={opportunity.id}>{opportunity.name}</option>)}</select> : <ContextValue value={selectedOpportunity?.name ?? "Selected Opportunity"} />}</DialogField><DialogField label="First name" htmlFor="sales-contact-first-name"><input id="sales-contact-first-name" ref={initialFocusRef} required value={firstName} onChange={(event) => setFirstName(event.target.value)} style={fullControlStyle} /></DialogField><DialogField label="Last name" htmlFor="sales-contact-last-name"><input id="sales-contact-last-name" required value={lastName} onChange={(event) => setLastName(event.target.value)} style={fullControlStyle} /></DialogField><DialogField label="Email" htmlFor="sales-contact-email"><input id="sales-contact-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} style={fullControlStyle} /></DialogField></> : null}</div><div style={{ display: "flex", justifyContent: "end", gap: "0.6rem", marginTop: "0.25rem" }}><button type="button" style={compactButtonStyle} onClick={onClose}>Cancel</button><button disabled={loading} style={primaryButtonStyle}>{isEdit ? "Save changes" : `Create ${dialog.kind === "contact" ? "Contact" : dialog.kind[0].toUpperCase() + dialog.kind.slice(1)}`}</button></div></form></div>;
}

function DialogField({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return <><label htmlFor={htmlFor} style={{ fontWeight: 600, color: "#334155" }}>{label}</label><div style={{ minWidth: 0 }}>{children}</div></>;
}

function ContextValue({ value }: { value: string }) { return <div style={{ minHeight: "2.5rem", padding: "0.55rem", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#f8fafc", color: "#334155", fontWeight: 600, boxSizing: "border-box" }}>{value}</div>; }
function visible<T extends { archivedAt: string | null; createdAt: string }>(records: T[], lifecycle: Lifecycle, sort: Sort, name: (record: T) => string): T[] { return records.filter((record) => lifecycle === "all" || (lifecycle === "archived" ? Boolean(record.archivedAt) : !record.archivedAt)).sort((left, right) => sort === "created" ? right.createdAt.localeCompare(left.createdAt) : name(left).localeCompare(name(right))); }
function normalizedUtc(value: string | null): { readonly iso: string; readonly display: string } | null { if (!value) return null; const instant = new Date(value); if (Number.isNaN(instant.getTime())) return null; const iso = instant.toISOString(); return { iso, display: `${iso.slice(0, 19).replace("T", " ")} UTC` }; }
function formatUtc(value: string | null): string { return normalizedUtc(value)?.display ?? "—"; }
function MonitoringTime({ value }: { readonly value: string | null }) { const normalized = normalizedUtc(value); if (!normalized) return <>—</>; const [date, time, zone] = normalized.display.split(" "); return <time dateTime={normalized.iso} title={`${normalized.iso} · ${normalized.display}`} style={{ display: "inline-block", whiteSpace: "normal", lineHeight: 1.35 }}><span style={{ whiteSpace: "nowrap" }}>{date}</span><br /><span style={{ whiteSpace: "nowrap" }}>{time} {zone}</span></time>; }
function labelAccountKind(value: Account["kind"]): string { return value === "current_customer" ? "Current customer" : "Prospect"; }
function labelStatus(value: Opportunity["status"]): string { return value[0].toUpperCase() + value.slice(1); }
