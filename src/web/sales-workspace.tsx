"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CloudShareConnectionFeature } from "./admin-cloudshare-connection";
import { AdminSupportFeature } from "./admin-support";
import { createAdminAuthenticatedRequest } from "./admin-authenticated-request";
import { accountLogoutButtonStyle, compactButtonStyle, dangerButtonStyle, disabledButtonStyle, primaryButtonStyle } from "./button-styles";
import { alertPanelStyle, cardStyle, mutedPanelStyle } from "./card-styles";
import { pageShellStyle } from "./page-shell";
import { PortalPageHeader } from "./portal-page-header";
import { SALES_TABS, buildSalesWorkspaceHref, getSalesTabLabel, type SalesItemView, type SalesNavigationIntent, type SalesWorkspaceRouteState } from "./sales-shell-route";
import { colors } from "./design-tokens";
import { addCloudShareWallClockMinutes, formatCloudShareWallClock } from "@/domain/cloudshare-wall-clock";

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
type Item = { id: string; name: string; description: string; project: Named; blueprints: Named[]; policy: Named; regions: Named[]; salesExperienceType: "demo" | "poc" | "pov" | "trial"; defaultDurationMinutes: number; status: "active" | "archived" };
type DemoSession = { id: string; opportunityId: string; itemId: string; cloudShareSalesExperienceId: string; externalId: string; type: "demo" | "poc" | "pov" | "trial"; start: string; end: string; timeZone: string; createdAt: string };

const blank: SalesData = { accounts: [], opportunities: [], contacts: [] };
const controlStyle = { padding: "0.55rem", border: "1px solid #b7bdc8", borderRadius: "6px", background: "#fff" };
const fullControlStyle = { ...controlStyle, width: "100%", minWidth: 0, boxSizing: "border-box" as const };
const salesWorkspaceStyle = { ...pageShellStyle, maxWidth: "96rem", margin: "0 auto", padding: "2rem clamp(1.25rem, 3vw, 3rem) 3rem" };
const tableStyle = { width: "100%", borderCollapse: "collapse" as const, tableLayout: "fixed" as const, minWidth: "66rem" };
const cellStyle = { padding: "0.7rem 0.65rem", borderBottom: "1px solid #e2e8f0", textAlign: "left" as const, verticalAlign: "middle" as const, whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" };
const actionCellStyle = { ...cellStyle, width: "9.5rem", textAlign: "right" as const };
const selectedRowStyle = { background: "#e8f5f3", boxShadow: "inset 4px 0 0 #0f6d66" };
const selectableRowStyle = { cursor: "pointer" };

export function SalesWorkspace({ email, initialRoute = { tab: "items", itemView: "catalog" } }: { readonly email: string; readonly initialRoute?: SalesWorkspaceRouteState }) {
  const router = useRouter();
  const [route, setRoute] = useState<SalesWorkspaceRouteState>(initialRoute);
  const browserFetch = useCallback<typeof fetch>((input, init) => window.fetch(input, init), []);
  const fetchAdmin = useMemo(() => createAdminAuthenticatedRequest({ fetchImpl: browserFetch, onSessionExpired: () => { router.replace("/login"); router.refresh(); } }), [browserFetch, router]);
  const logout = useCallback(async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }, [router]);
  const navigate = useCallback((intent: SalesNavigationIntent) => {
    const next: SalesWorkspaceRouteState = {
      tab: intent.tab,
      itemView: intent.tab === "items" ? intent.itemView ?? "catalog" : "catalog",
      ...(intent.tab === "items" && intent.itemId ? { itemId: intent.itemId } : {}),
      ...((intent.tab === "records" || intent.tab === "sessions") && intent.accountId ? { accountId: intent.accountId } : {}),
      ...((intent.tab === "records" || intent.tab === "sessions") && intent.opportunityId ? { opportunityId: intent.opportunityId } : {}),
      ...(intent.tab === "support" && intent.correlationId ? { correlationId: intent.correlationId } : {}),
    };
    router.push(buildSalesWorkspaceHref(intent));
    setRoute(next);
  }, [router]);

  return <main style={salesWorkspaceStyle}>
    <PortalPageHeader eyebrow="Certalis Sales Portal" title="Sales Workspace" description="Curate reusable Demo Items, commercial records, and time-bound CloudShare Sales Experiences in the isolated Certalis Customer workspace." email={email} actions={<button onClick={() => void logout()} style={accountLogoutButtonStyle}>Log out</button>} />
    <nav aria-label="Sales workspace sections" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))", gap: "0.5rem", marginBottom: "1rem", borderBottom: `1px solid ${colors.border}`, paddingBottom: "0.5rem" }}>{SALES_TABS.map((tab) => {
      const active = route.tab === tab;
      return <button key={tab} type="button" aria-current={active ? "page" : undefined} onClick={() => navigate({ tab })} style={{ padding: "0.65rem 0.9rem", border: "1px solid", borderRadius: "8px", background: active ? colors.textPrimary : "#ffffff", color: active ? "#ffffff" : colors.textPrimary, borderColor: active ? colors.textPrimary : colors.border, cursor: "pointer", fontWeight: active ? 700 : 600 }}>{getSalesTabLabel(tab)}</button>;
    })}</nav>
    {route.tab === "items" ? <ItemCatalog fetchAdmin={fetchAdmin} view={route.itemView ?? "catalog"} focusedItemId={route.itemId} onNavigate={navigate} /> : null}
    {route.tab === "records" ? <SalesRecordsFeature initialSelection={{ accountId: route.accountId ?? null, opportunityId: route.opportunityId ?? null }} onNavigate={navigate} /> : null}
    {route.tab === "sessions" ? <SalesDemoSessionsFeature onNavigate={navigate} /> : null}
    {route.tab === "support" ? <section aria-label="Sales support"><PortalSectionIntro title="Sales support" description="Append-only support evidence for Sales records and live Item resource curation in the Certalis Customer workspace." /><AdminSupportFeature active view="diagnostics" diagnosticFilters={route.correlationId ? { correlationId: route.correlationId } : {}} diagnosticsEndpoint="/api/sales/diagnostics" fetchAdmin={fetchAdmin} onNavigate={(intent) => navigate({ tab: "support", correlationId: intent.diagnosticFilters?.correlationId })} /></section> : null}
    {route.tab === "configuration" ? <section aria-label="Sales configuration"><PortalSectionIntro title="CloudShare Connection" description="Manage the encrypted CloudShare Connection for the isolated Certalis Sales Customer." /><CloudShareConnectionFeature active fetchAdmin={fetchAdmin} getNavigationHref={() => buildSalesWorkspaceHref({ tab: "configuration" })} onNavigate={() => undefined} /></section> : null}
  </main>;
}

function PortalSectionIntro({ title, description }: { title: string; description: string }) {
  return <section style={{ ...mutedPanelStyle, display: "grid", gap: "0.4rem", marginBottom: "1rem" }}><h2 style={{ margin: 0 }}>{title}</h2><p style={{ margin: 0 }}>{description}</p></section>;
}

function SalesDemoSessionsFeature({ onNavigate }: { readonly onNavigate: (intent: SalesNavigationIntent) => void }) {
  const router = useRouter();
  const browserFetch = useCallback<typeof fetch>((input, init) => window.fetch(input, init), []);
  const fetchSales = useMemo(() => createAdminAuthenticatedRequest({ fetchImpl: browserFetch, onSessionExpired: () => { router.replace("/login"); router.refresh(); } }), [browserFetch, router]);
  const [records, setRecords] = useState<SalesData>(blank);
  const [items, setItems] = useState<Item[]>([]);
  const [sessions, setSessions] = useState<DemoSession[]>([]);
  const [opportunityId, setOpportunityId] = useState("");
  const [itemId, setItemId] = useState("");
  const [startMode, setStartMode] = useState<"now" | "scheduled">("now");
  const [start, setStart] = useState(() => formatCloudShareWallClock(new Date(), "UTC") ?? "");
  const [end, setEnd] = useState("");
  const [timeZone, setTimeZone] = useState("UTC");
  const [type, setType] = useState<Item["salesExperienceType"]>("demo");
  const [message, setMessage] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const selectedItem = items.find((item) => item.id === itemId) ?? null;
  const selectedItemType = selectedItem?.salesExperienceType;
  const selectedItemDuration = selectedItem?.defaultDurationMinutes;

  const load = useCallback(async () => {
    const [recordResponse, itemResponse] = await Promise.all([fetchSales("/api/sales/accounts", { cache: "no-store" }), fetchSales("/api/sales/items", { cache: "no-store" })]);
    const recordBody = await recordResponse.json() as SalesData & { error?: string };
    const itemBody = await itemResponse.json() as { activeItems?: Item[]; error?: string };
    if (!recordResponse.ok || !itemResponse.ok) throw new Error(recordBody.error ?? itemBody.error ?? "Could not load Sales Demo Session choices.");
    setRecords(recordBody); setItems(itemBody.activeItems ?? []);
  }, [fetchSales]);
  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "Could not load Sales Demo Session choices.")); }, [load]);
  useEffect(() => {
    if (!selectedItemType || !selectedItemDuration) return;
    setType(selectedItemType);
    setEnd(addCloudShareWallClockMinutes(start, timeZone, selectedItemDuration) ?? "");
  }, [selectedItemType, selectedItemDuration, start, timeZone]);
  useEffect(() => { if (selectedItemDuration && startMode === "now") { const next = formatCloudShareWallClock(new Date(), timeZone) ?? ""; setStart(next); setEnd(addCloudShareWallClockMinutes(next, timeZone, selectedItemDuration) ?? ""); } }, [startMode, selectedItemDuration, timeZone]);
  useEffect(() => { if (selectedItemDuration) setEnd(addCloudShareWallClockMinutes(start, timeZone, selectedItemDuration) ?? ""); }, [start, selectedItemDuration, timeZone]);
  useEffect(() => { if (!opportunityId) { setSessions([]); return; } void fetchSales(`/api/sales/demo-sessions?opportunityId=${encodeURIComponent(opportunityId)}`, { cache: "no-store" }).then(async (response) => { const body = await response.json() as { sessions?: DemoSession[] }; if (response.ok) setSessions(body.sessions ?? []); }); }, [fetchSales, opportunityId]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setMessage(null); setCorrelationId(null); setLoading(true);
    try {
      const response = await fetchSales("/api/sales/demo-sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ opportunityId, itemId, start, end, timeZone, type }) });
      const body = await response.json() as { error?: string; correlationId?: string; session?: DemoSession };
      if (!response.ok) { setCorrelationId(body.correlationId ?? null); throw new Error(body.error ?? "Could not provision the Sales Demo Session."); }
      setSessions((current) => body.session ? [body.session, ...current] : current); setMessage("Sales Demo Session created. No invitations were sent.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not provision the Sales Demo Session."); } finally { setLoading(false); }
  };
  const opportunities = records.opportunities.filter((opportunity) => !opportunity.archivedAt);
  return <section aria-label="Sales Demo Sessions">
    <PortalSectionIntro title="Provision a Sales Demo Session" description="Creates one time-bound CloudShare Sales Experience. Registered participants only; invitations stay suppressed until the later enrollment and invitation slices." />
    <form onSubmit={submit} style={{ ...cardStyle, padding: "1.25rem", display: "grid", gap: "1rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))", gap: "1rem" }}>
        <label style={{ display: "grid", gap: "0.35rem" }}>Opportunity<select aria-label="Opportunity" required value={opportunityId} onChange={(event) => setOpportunityId(event.target.value)} style={fullControlStyle}><option value="">Select an Opportunity</option>{opportunities.map((opportunity) => <option key={opportunity.id} value={opportunity.id}>{opportunity.name}</option>)}</select></label>
        <label style={{ display: "grid", gap: "0.35rem" }}>Demo Item<select aria-label="Demo Item" required value={itemId} onChange={(event) => setItemId(event.target.value)} style={fullControlStyle}><option value="">Select a Demo Item</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label style={{ display: "grid", gap: "0.35rem" }}>Sales Experience type<select aria-label="Sales Experience type" value={type} onChange={(event) => setType(event.target.value as Item["salesExperienceType"])} style={fullControlStyle}><option value="demo">Demo</option><option value="poc">POC</option><option value="pov">POV</option><option value="trial">Trial</option></select></label>
        <label style={{ display: "grid", gap: "0.35rem" }}>CloudShare time zone<select aria-label="CloudShare time zone" value={timeZone} onChange={(event) => setTimeZone(event.target.value)} style={fullControlStyle}><option value="UTC">UTC</option><option value="Eastern Standard Time">Eastern Standard Time</option><option value="Mountain Standard Time">Mountain Standard Time</option><option value="Pacific Standard Time">Pacific Standard Time</option></select></label>
      </div>
      <fieldset style={{ border: "1px solid #d8dee8", borderRadius: "8px", padding: "0.85rem", display: "grid", gap: "0.7rem" }}><legend>Time window</legend><div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}><label><input type="radio" checked={startMode === "now"} onChange={() => setStartMode("now")} /> Start now</label><label><input type="radio" checked={startMode === "scheduled"} onChange={() => setStartMode("scheduled")} /> Schedule start</label></div><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))", gap: "1rem" }}><label style={{ display: "grid", gap: "0.35rem" }}>Start <input aria-label="Start" type="datetime-local" required value={start} disabled={startMode === "now"} onChange={(event) => setStart(event.target.value)} style={fullControlStyle} /></label><label style={{ display: "grid", gap: "0.35rem" }}>End <input aria-label="End" type="datetime-local" required value={end} onChange={(event) => setEnd(event.target.value)} style={fullControlStyle} /></label></div><p style={{ margin: 0, color: "#52606d" }}>End is required and prefilled from the selected Item Policy storage lease. All displayed values are local CloudShare date-times in the selected explicit time zone.</p></fieldset>
      <div style={{ display: "flex", justifyContent: "end", gap: "0.75rem", alignItems: "center" }}><button style={primaryButtonStyle} disabled={loading || !opportunityId || !itemId}>{loading ? "Provisioning…" : "Create Sales Demo Session"}</button></div>
      {message ? <div role={correlationId ? "alert" : "status"} style={correlationId ? alertPanelStyle.danger : alertPanelStyle.success}>{message}{correlationId ? <> <button type="button" onClick={() => onNavigate({ tab: "support", correlationId })} style={{ border: 0, background: "transparent", color: colors.info, textDecoration: "underline", cursor: "pointer" }}>Open support diagnostics ({correlationId})</button></> : null}</div> : null}
    </form>
    {opportunityId ? <section style={{ ...cardStyle, marginTop: "1rem", padding: "1.25rem" }} aria-label="Opportunity Sales Demo Session history"><h2 style={{ marginTop: 0 }}>Session history</h2>{sessions.length === 0 ? <p>No Sales Demo Sessions have been created for this Opportunity.</p> : <ul>{sessions.map((session) => <li key={session.id}>{session.type.toUpperCase()} · {session.start} to {session.end} ({session.timeZone})</li>)}</ul>}</section> : null}
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
    onNavigate({ tab: "records", accountId, opportunityId });
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
  const [salesExperienceType, setSalesExperienceType] = useState<Item["salesExperienceType"]>("demo");
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
      const response = await fetchAdmin(editingId ? `/api/sales/items/${encodeURIComponent(editingId)}` : "/api/sales/items", { method: editingId ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, description, projectId, blueprintIds, policyId, regionIds, salesExperienceType }) });
      const body = await response.json() as { error?: string; correlationId?: string | null };
      if (!response.ok) { setError(body.error ?? "Unable to save Item"); setErrorCorrelationId(body.correlationId ?? null); return; }
      setName(""); setDescription(""); setBlueprintIds([]); setRegionIds([]); setEditingId(null); await loadItems(); onNavigate({ tab: "items", itemView: "catalog" });
    } finally { setLoading(false); }
  };
  const cancelAuthoring = () => {
    setName(""); setDescription(""); setProjectId(""); setBlueprintIds([]); setPolicyId(""); setRegionIds([]); setSalesExperienceType("demo"); setEditingId(null); setError(null); setErrorCorrelationId(null);
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
    setEditingId(item.id); setName(item.name); setDescription(item.description); setBlueprintIds(item.blueprints.map((blueprint) => blueprint.id)); setPolicyId(item.policy.id); setRegionIds(item.regions.map((region) => region.id)); setSalesExperienceType(item.salesExperienceType);
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
    {view === "catalog" ? <><section style={{ ...mutedPanelStyle, display: "grid", gap: "0.75rem" }}><h2 style={{ margin: 0 }}>Item catalogue</h2><p style={{ margin: 0 }}>Choose a reusable, archive-only Item. It does not provision an Enablement Session or share an environment.</p><div><button type="button" style={primaryButtonStyle} onClick={() => onNavigate({ tab: "items", itemView: "create" })}>Create Item</button></div></section><section aria-label="Active Items" style={{ ...cardStyle, padding: "1.1rem" }}><h2 style={{ margin: 0 }}>Active Items</h2>{items.length === 0 ? <p>No active Items yet.</p> : <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>{items.map((item) => <article key={item.id} style={{ border: "1px solid #d6dbe3", borderRadius: "8px", padding: "0.9rem" }}><strong>{item.name}</strong><p style={{ margin: "0.35rem 0" }}>{item.blueprints.map((blueprint) => blueprint.name).join(" → ")} · {item.policy.name} · {item.regions.map((region) => region.name).join(", ")}</p><p style={{ margin: "0.35rem 0" }}>{item.defaultDurationMinutes} min · {item.salesExperienceType.toUpperCase()}</p><button type="button" onClick={() => onNavigate({ tab: "items", itemView: "detail", itemId: item.id })}>View details</button></article>)}</div>}</section><section aria-label="Archived Items" style={{ ...mutedPanelStyle }}><h2 style={{ margin: 0 }}>Archived history</h2>{archived.length === 0 ? <p>No archived Items.</p> : <ul>{archived.map((item) => <li key={item.id}>{item.name} (archived; cannot start an Enablement Session)</li>)}</ul>}</section></> : null}
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
            <div className="item-authoring-field"><label className="item-authoring-label" htmlFor="item-sales-experience-type">Item type</label><select id="item-sales-experience-type" className="item-authoring-control" aria-label="Item type" value={salesExperienceType} onChange={(event) => setSalesExperienceType(event.target.value as Item["salesExperienceType"])}><option value="demo">Demo</option><option value="poc">POC</option><option value="pov">POV</option><option value="trial">Trial</option></select></div>
          </div>
          <div className="item-authoring-actions"><button type="button" style={compactButtonStyle} onClick={cancelAuthoring} disabled={loading}>Cancel</button><button type="button" style={primaryButtonStyle} onClick={() => void save()} disabled={loading}>{view === "edit" ? "Save Item changes" : "Save Item"}</button></div>
          {error ? <ItemFailureAlert message={error} correlationId={errorCorrelationId} onDismiss={() => { setError(null); setErrorCorrelationId(null); }} onOpenSupport={() => errorCorrelationId && onNavigate({ tab: "support", correlationId: errorCorrelationId })} /> : null}
        </form>
      </section>
    </> : null}
    {view === "detail" ? <section aria-label="Item inspection" style={{ ...mutedPanelStyle, display: "grid", gap: "0.75rem" }}><button type="button" style={compactButtonStyle} onClick={() => onNavigate({ tab: "items", itemView: "catalog" })}>Back to catalogue</button>{inspected ? <><h2 style={{ margin: 0 }}>{inspected.name}</h2><p style={{ margin: 0 }}>{inspected.description}</p><p style={{ margin: 0 }}>{inspected.blueprints.map((blueprint) => blueprint.name).join(" → ")} · {inspected.policy.name} · {inspected.regions.map((region) => region.name).join(", ")} · {inspected.defaultDurationMinutes} min · {inspected.salesExperienceType.toUpperCase()}</p><div style={{ display: "flex", gap: "0.5rem" }}><button type="button" onClick={() => onNavigate({ tab: "items", itemView: "edit", itemId: inspected.id })}>Edit</button><button type="button" style={dangerButtonStyle} onClick={() => void archive(inspected.id)}>Archive</button></div></> : <p>Loading Item details…</p>}{error ? <ItemFailureAlert message={error} correlationId={errorCorrelationId} onDismiss={() => { setError(null); setErrorCorrelationId(null); }} onOpenSupport={() => errorCorrelationId && onNavigate({ tab: "support", correlationId: errorCorrelationId })} /> : null}</section> : null}
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
function formatUtc(value: string | null): string { return value ? `${value.slice(0, 19).replace("T", " ")} UTC` : "—"; }
function labelAccountKind(value: Account["kind"]): string { return value === "current_customer" ? "Current customer" : "Prospect"; }
function labelStatus(value: Opportunity["status"]): string { return value[0].toUpperCase() + value.slice(1); }
