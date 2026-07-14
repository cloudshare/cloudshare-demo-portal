"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CloudShareConnectionFeature } from "./admin-cloudshare-connection";
import { AdminSupportFeature } from "./admin-support";
import { createAdminAuthenticatedRequest } from "./admin-authenticated-request";
import { accountLogoutButtonStyle, compactButtonStyle, dangerButtonStyle, disabledButtonStyle, primaryButtonStyle } from "./button-styles";
import { cardStyle, mutedPanelStyle } from "./card-styles";
import { pageShellStyle } from "./page-shell";
import { PortalPageHeader } from "./portal-page-header";
import { SALES_TABS, buildSalesWorkspaceHref, getSalesTabLabel, type SalesDemoItemView, type SalesNavigationIntent, type SalesWorkspaceRouteState } from "./sales-shell-route";
import { colors } from "./design-tokens";

type Account = { id: string; name: string; kind: "prospect" | "current_customer"; archivedAt: string | null; createdAt: string; updatedAt?: string };
type Opportunity = { id: string; accountId: string; name: string; status: "open" | "won" | "lost"; archivedAt: string | null; createdAt: string; updatedAt?: string };
type Contact = { id: string; opportunityId: string; firstName: string; lastName: string; email: string; archivedAt: string | null; createdAt: string; updatedAt?: string };
type SalesData = { accounts: Account[]; opportunities: Opportunity[]; contacts: Contact[] };
type SalesSelection = { accountId: string | null; opportunityId: string | null };
type Lifecycle = "active" | "archived" | "all";
type Sort = "name" | "created";
type Dialog = { kind: "account"; record?: Account } | { kind: "opportunity"; record?: Opportunity } | { kind: "contact"; record?: Contact } | null;
type Named = { id: string; name: string; friendlyName?: string };
type Policy = Named & { storageLeaseMinutes: number | null };
type DemoItem = { id: string; name: string; description: string; project: Named; blueprints: Named[]; policy: Named; region: Named; salesExperienceType: "demo" | "poc" | "pov" | "trial"; defaultDurationMinutes: number; status: "active" | "archived" };

const blank: SalesData = { accounts: [], opportunities: [], contacts: [] };
const controlStyle = { padding: "0.55rem", border: "1px solid #b7bdc8", borderRadius: "6px", background: "#fff" };
const fullControlStyle = { ...controlStyle, width: "100%", minWidth: 0, boxSizing: "border-box" as const };
const salesWorkspaceStyle = { ...pageShellStyle, maxWidth: "96rem", margin: "0 auto", padding: "2rem clamp(1.25rem, 3vw, 3rem) 3rem" };
const tableStyle = { width: "100%", borderCollapse: "collapse" as const, tableLayout: "fixed" as const, minWidth: "66rem" };
const cellStyle = { padding: "0.7rem 0.65rem", borderBottom: "1px solid #e2e8f0", textAlign: "left" as const, verticalAlign: "middle" as const, whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" };
const actionCellStyle = { ...cellStyle, width: "9.5rem", textAlign: "right" as const };
const selectedRowStyle = { background: "#e8f5f3", boxShadow: "inset 4px 0 0 #0f6d66" };
const selectableRowStyle = { cursor: "pointer" };

export function SalesWorkspace({ email, initialRoute = { tab: "demo-items", demoItemView: "catalog" } }: { readonly email: string; readonly initialRoute?: SalesWorkspaceRouteState }) {
  const router = useRouter();
  const [route, setRoute] = useState<SalesWorkspaceRouteState>(initialRoute);
  const browserFetch = useCallback<typeof fetch>((input, init) => window.fetch(input, init), []);
  const fetchAdmin = useMemo(() => createAdminAuthenticatedRequest({ fetchImpl: browserFetch, onSessionExpired: () => { router.replace("/login"); router.refresh(); } }), [browserFetch, router]);
  const logout = useCallback(async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }, [router]);
  const navigate = useCallback((intent: SalesNavigationIntent) => {
    const next: SalesWorkspaceRouteState = {
      tab: intent.tab,
      demoItemView: intent.tab === "demo-items" ? intent.demoItemView ?? "catalog" : "catalog",
      ...(intent.tab === "demo-items" && intent.demoItemId ? { demoItemId: intent.demoItemId } : {}),
      ...(intent.tab === "records" && intent.accountId ? { accountId: intent.accountId } : {}),
      ...(intent.tab === "records" && intent.opportunityId ? { opportunityId: intent.opportunityId } : {}),
    };
    router.push(buildSalesWorkspaceHref(intent));
    setRoute(next);
  }, [router]);

  return <main style={salesWorkspaceStyle}>
    <PortalPageHeader eyebrow="Certalis Sales Portal" title="Sales Workspace" description="Curate archive-only CloudShare Demo Items and customer-scoped commercial records. No CRM sync or Sales Experience provisioning is performed here." email={email} actions={<button onClick={() => void logout()} style={accountLogoutButtonStyle}>Log out</button>} />
    <nav aria-label="Sales workspace sections" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))", gap: "0.5rem", marginBottom: "1rem", borderBottom: `1px solid ${colors.border}`, paddingBottom: "0.5rem" }}>{SALES_TABS.map((tab) => {
      const active = route.tab === tab;
      return <button key={tab} type="button" aria-current={active ? "page" : undefined} onClick={() => navigate({ tab })} style={{ padding: "0.65rem 0.9rem", border: "1px solid", borderRadius: "8px", background: active ? colors.textPrimary : "#ffffff", color: active ? "#ffffff" : colors.textPrimary, borderColor: active ? colors.textPrimary : colors.border, cursor: "pointer", fontWeight: active ? 700 : 600 }}>{getSalesTabLabel(tab)}</button>;
    })}</nav>
    {route.tab === "demo-items" ? <DemoItemCatalog fetchAdmin={fetchAdmin} view={route.demoItemView} focusedDemoItemId={route.demoItemId} onNavigate={navigate} /> : null}
    {route.tab === "records" ? <SalesRecordsFeature initialSelection={{ accountId: route.accountId ?? null, opportunityId: route.opportunityId ?? null }} onNavigate={navigate} /> : null}
    {route.tab === "support" ? <section aria-label="Sales support"><PortalSectionIntro title="Sales support" description="Append-only support evidence for Sales records and live Demo Item resource curation in the Certalis Customer workspace." /><AdminSupportFeature active view="diagnostics" diagnosticFilters={{}} diagnosticsEndpoint="/api/sales/diagnostics" fetchAdmin={fetchAdmin} onNavigate={() => undefined} /></section> : null}
    {route.tab === "configuration" ? <section aria-label="Sales configuration"><PortalSectionIntro title="CloudShare Connection" description="Manage the encrypted CloudShare Connection for the isolated Certalis Sales Customer." /><CloudShareConnectionFeature active fetchAdmin={fetchAdmin} getNavigationHref={() => buildSalesWorkspaceHref({ tab: "configuration" })} onNavigate={() => undefined} /></section> : null}
  </main>;
}

function PortalSectionIntro({ title, description }: { title: string; description: string }) {
  return <section style={{ ...mutedPanelStyle, display: "grid", gap: "0.4rem", marginBottom: "1rem" }}><h2 style={{ margin: 0 }}>{title}</h2><p style={{ margin: 0 }}>{description}</p></section>;
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

function DemoItemCatalog({ fetchAdmin, view, focusedDemoItemId, onNavigate }: { readonly fetchAdmin: typeof fetch; readonly view: SalesDemoItemView; readonly focusedDemoItemId?: string; readonly onNavigate: (intent: SalesNavigationIntent) => void }) {
  const [items, setItems] = useState<DemoItem[]>([]);
  const [archived, setArchived] = useState<DemoItem[]>([]);
  const [projects, setProjects] = useState<Named[]>([]);
  const [regions, setRegions] = useState<Named[]>([]);
  const [blueprints, setBlueprints] = useState<Named[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [projectId, setProjectId] = useState("");
  const [blueprintIds, setBlueprintIds] = useState<string[]>([]);
  const [policyId, setPolicyId] = useState("");
  const [regionId, setRegionId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [salesExperienceType, setSalesExperienceType] = useState<DemoItem["salesExperienceType"]>("demo");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [inspected, setInspected] = useState<DemoItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const selectedPolicy = policies.find((policy) => policy.id === policyId);

  const loadItems = useCallback(async () => {
    const response = await fetchAdmin("/api/sales/demo-items");
    const body = await response.json() as { activeDemoItems?: DemoItem[]; archivedDemoItems?: DemoItem[]; error?: string };
    if (!response.ok) throw new Error(body.error ?? "Failed to load Demo Items");
    setItems(body.activeDemoItems ?? []);
    setArchived(body.archivedDemoItems ?? []);
  }, [fetchAdmin]);
  const loadBootstrap = useCallback(async () => {
    setLoading(true); setError(null); setDiagnostic(null);
    try {
      const response = await fetchAdmin("/api/sales/demo-item-authoring?refresh=true");
      const body = await response.json() as { projects?: Named[]; regions?: Named[]; error?: string; diagnostic?: Record<string, unknown> };
      if (!response.ok) { setError(body.error ?? "Failed to load CloudShare resources"); setDiagnostic(body.diagnostic ?? null); return; }
      setProjects(body.projects ?? []); setRegions(body.regions ?? []);
    } finally { setLoading(false); }
  }, [fetchAdmin]);
  useEffect(() => { void loadItems().catch((caught) => setError(caught instanceof Error ? caught.message : "Failed to load Demo Items")); }, [loadItems]);
  useEffect(() => {
    if (view === "create") void loadBootstrap();
  }, [loadBootstrap, view]);

  const selectProject = useCallback(async (next: string) => {
    setProjectId(next); setBlueprintIds([]); setPolicyId(""); setBlueprints([]); setPolicies([]);
    if (!next) return;
    setLoading(true); setError(null); setDiagnostic(null);
    try {
      const response = await fetchAdmin(`/api/sales/demo-item-authoring/projects/${encodeURIComponent(next)}?refresh=true`);
      const body = await response.json() as { blueprints?: Named[]; policies?: Policy[]; error?: string; diagnostic?: Record<string, unknown> };
      if (!response.ok) { setError(body.error ?? "Failed to load Project resources"); setDiagnostic(body.diagnostic ?? null); return; }
      setBlueprints(body.blueprints ?? []); setPolicies(body.policies ?? []);
    } finally { setLoading(false); }
  }, [fetchAdmin]);
  const save = async () => {
    setLoading(true); setError(null); setDiagnostic(null);
    try {
      const response = await fetchAdmin(editingId ? `/api/sales/demo-items/${encodeURIComponent(editingId)}` : "/api/sales/demo-items", { method: editingId ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, description, projectId, blueprintIds, policyId, regionId, salesExperienceType }) });
      const body = await response.json() as { error?: string; diagnostic?: Record<string, unknown> };
      if (!response.ok) { setError(body.error ?? "Unable to save Demo Item"); setDiagnostic(body.diagnostic ?? null); return; }
      setName(""); setDescription(""); setBlueprintIds([]); setEditingId(null); await loadItems(); onNavigate({ tab: "demo-items" });
    } finally { setLoading(false); }
  };
  const inspect = useCallback(async (id: string) => {
    const response = await fetchAdmin(`/api/sales/demo-items/${encodeURIComponent(id)}`);
    const body = await response.json() as { demoItem?: DemoItem; error?: string; diagnostic?: Record<string, unknown> };
    if (!response.ok) { setError(body.error ?? "Unable to inspect Demo Item"); setDiagnostic(body.diagnostic ?? null); return; }
    setInspected(body.demoItem ?? null);
  }, [fetchAdmin]);
  const edit = useCallback(async (item: DemoItem) => {
    await loadBootstrap(); await selectProject(item.project.id);
    setEditingId(item.id); setName(item.name); setDescription(item.description); setBlueprintIds(item.blueprints.map((blueprint) => blueprint.id)); setPolicyId(item.policy.id); setRegionId(item.region.id); setSalesExperienceType(item.salesExperienceType);
  }, [loadBootstrap, selectProject]);
  const archive = async (id: string) => {
    setError(null);
    const response = await fetchAdmin(`/api/sales/demo-items/${encodeURIComponent(id)}/archive`, { method: "POST" });
    const body = await response.json() as { error?: string; diagnostic?: Record<string, unknown> };
    if (!response.ok) { setError(body.error ?? "Unable to archive Demo Item"); setDiagnostic(body.diagnostic ?? null); return; }
    await loadItems(); onNavigate({ tab: "demo-items" });
  };

  useEffect(() => {
    if (view === "detail" && focusedDemoItemId) void inspect(focusedDemoItemId);
  }, [focusedDemoItemId, inspect, view]);
  useEffect(() => {
    if (view !== "edit" || !focusedDemoItemId) return;
    const item = items.find((candidate) => candidate.id === focusedDemoItemId);
    if (item) void edit(item);
  }, [edit, focusedDemoItemId, items, view]);

  return <section style={{ display: "grid", gap: "1rem", marginTop: "1rem" }} aria-label="Demo Item catalog">
    {view === "catalog" ? <><section style={{ ...mutedPanelStyle, display: "grid", gap: "0.75rem" }}><h2 style={{ margin: 0 }}>Demo Item catalog</h2><p style={{ margin: 0 }}>Choose a reusable, archive-only Demo Item template. It does not provision a Sales Experience or share an environment.</p><div><button type="button" style={primaryButtonStyle} onClick={() => onNavigate({ tab: "demo-items", demoItemView: "create" })}>Create Demo Item</button></div></section><section aria-label="Active Demo Items" style={{ ...cardStyle, padding: "1.1rem" }}><h2 style={{ margin: 0 }}>Active Demo Items</h2>{items.length === 0 ? <p>No active Demo Items yet.</p> : <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>{items.map((item) => <article key={item.id} style={{ border: "1px solid #d6dbe3", borderRadius: "8px", padding: "0.9rem" }}><strong>{item.name}</strong><p style={{ margin: "0.35rem 0" }}>{item.blueprints.map((blueprint) => blueprint.name).join(" → ")} · {item.policy.name} · {item.region.name}</p><p style={{ margin: "0.35rem 0" }}>{item.defaultDurationMinutes} min · {item.salesExperienceType.toUpperCase()}</p><button type="button" onClick={() => onNavigate({ tab: "demo-items", demoItemView: "detail", demoItemId: item.id })}>View details</button></article>)}</div>}</section><section aria-label="Archived Demo Items" style={{ ...mutedPanelStyle }}><h2 style={{ margin: 0 }}>Archived history</h2>{archived.length === 0 ? <p>No archived Demo Items.</p> : <ul>{archived.map((item) => <li key={item.id}>{item.name} (archived; cannot start a Sales Demo Session)</li>)}</ul>}</section></> : null}
    {view === "create" || view === "edit" ? <>
      <style>{`
        .demo-item-authoring-shell { max-width: 66rem; }
        .demo-item-authoring-form { display: grid; gap: 1.5rem; }
        .demo-item-authoring-header { display: grid; gap: 0.5rem; }
        .demo-item-authoring-header p { margin: 0; color: ${colors.textSecondary}; line-height: 1.5; }
        .demo-item-authoring-fields { display: grid; gap: 1rem; }
        .demo-item-authoring-field { display: grid; grid-template-columns: minmax(9rem, 11rem) minmax(0, 1fr); gap: 1rem; align-items: start; }
        .demo-item-authoring-label { color: ${colors.textPrimary}; font-weight: 600; line-height: 1.45; padding-top: 0.7rem; }
        .demo-item-authoring-control { width: 100%; min-width: 0; min-height: 2.7rem; box-sizing: border-box; padding: 0.65rem 0.75rem; border: 1px solid ${colors.borderStrong}; border-radius: 6px; background: ${colors.surface}; color: ${colors.textPrimary}; font: inherit; line-height: 1.35; }
        .demo-item-authoring-control:focus { outline: 3px solid ${colors.accentSoft}; outline-offset: 1px; border-color: ${colors.accent}; }
        .demo-item-authoring-control--textarea { min-height: 7rem; resize: vertical; }
        .demo-item-resource-set { display: grid; gap: 1rem; margin: 0; padding: 1rem; border: 1px solid ${colors.border}; border-radius: 8px; background: ${colors.surface}; }
        .demo-item-resource-set legend { padding: 0 0.35rem; color: ${colors.textPrimary}; font-weight: 700; }
        .demo-item-blueprint-set { display: grid; gap: 0.6rem; margin: 0; padding: 0.85rem 1rem; border: 1px solid ${colors.border}; border-radius: 6px; background: ${colors.surfaceMuted}; }
        .demo-item-blueprint-set legend { padding: 0 0.25rem; font-weight: 600; }
        .demo-item-blueprint-options { display: grid; gap: 0.55rem; }
        .demo-item-blueprint-option { display: flex; align-items: center; gap: 0.6rem; min-height: 1.5rem; line-height: 1.35; }
        .demo-item-blueprint-empty, .demo-item-policy-help { margin: 0; color: ${colors.textMuted}; font-size: 0.9rem; line-height: 1.45; }
        .demo-item-authoring-actions { display: flex; align-items: center; gap: 0.75rem; padding-top: 0.25rem; }
        @media (max-width: 640px) { .demo-item-authoring-field { grid-template-columns: 1fr; gap: 0.45rem; } .demo-item-authoring-label { padding-top: 0; } .demo-item-resource-set { padding: 0.85rem; } }
      `}</style>
      <section aria-label="Demo Item authoring" className="demo-item-authoring-shell" style={{ ...mutedPanelStyle, padding: "clamp(1.1rem, 3vw, 1.75rem)" }}>
        <form aria-label="Demo Item authoring form" className="demo-item-authoring-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className="demo-item-authoring-header">
            <div><button type="button" style={compactButtonStyle} onClick={() => onNavigate({ tab: "demo-items", demoItemView: "catalog" })}>Back to catalog</button><h2 style={{ margin: "0.85rem 0 0" }}>{view === "edit" ? "Edit Demo Item" : "Create Demo Item"}</h2></div>
            <p>Select live CloudShare resources by friendly name. Blueprint order is the future launch order.</p>
          </div>
          <div className="demo-item-authoring-fields">
            <div className="demo-item-authoring-field"><label className="demo-item-authoring-label" htmlFor="demo-item-name">Name</label><input id="demo-item-name" className="demo-item-authoring-control" aria-label="Demo Item name" value={name} onChange={(event) => setName(event.target.value)} /></div>
            <div className="demo-item-authoring-field"><label className="demo-item-authoring-label" htmlFor="demo-item-description">Description</label><textarea id="demo-item-description" className="demo-item-authoring-control demo-item-authoring-control--textarea" rows={4} value={description} onChange={(event) => setDescription(event.target.value)} /></div>
            <fieldset className="demo-item-resource-set"><legend>Live CloudShare resources</legend>
              <div className="demo-item-authoring-field"><label className="demo-item-authoring-label" htmlFor="demo-item-project">Project</label><select id="demo-item-project" className="demo-item-authoring-control" aria-label="Project" value={projectId} onChange={(event) => void selectProject(event.target.value)}><option value="">Select a Project</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
              <fieldset className="demo-item-blueprint-set"><legend>Blueprints (selection order is launch order)</legend>{loading ? <p className="demo-item-blueprint-empty">Loading Blueprints for this Project…</p> : !projectId ? <p className="demo-item-blueprint-empty">Choose a Project to see its Blueprints.</p> : blueprints.length === 0 ? <p className="demo-item-blueprint-empty">No Blueprints are available for this Project.</p> : <div className="demo-item-blueprint-options">{blueprints.map((item) => <label key={item.id} className="demo-item-blueprint-option"><input type="checkbox" checked={blueprintIds.includes(item.id)} onChange={() => setBlueprintIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /> <span>{item.name}</span></label>)}</div>}</fieldset>
              <div className="demo-item-authoring-field"><label className="demo-item-authoring-label" htmlFor="demo-item-policy">Policy</label><div style={{ display: "grid", gap: "0.45rem", minWidth: 0 }}><select id="demo-item-policy" className="demo-item-authoring-control" aria-label="Policy" value={policyId} onChange={(event) => setPolicyId(event.target.value)}><option value="">Select a Policy</option>{policies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><p className="demo-item-policy-help">{selectedPolicy?.storageLeaseMinutes ? `Default duration: ${selectedPolicy.storageLeaseMinutes} minutes (Policy storage lease)` : "Choose a Policy with a storage lease."}</p></div></div>
              <div className="demo-item-authoring-field"><label className="demo-item-authoring-label" htmlFor="demo-item-region">Region</label><select id="demo-item-region" className="demo-item-authoring-control" aria-label="Region" value={regionId} onChange={(event) => setRegionId(event.target.value)}><option value="">Select a Region</option>{regions.map((item) => <option key={item.id} value={item.id}>{item.friendlyName ?? item.name}</option>)}</select></div>
            </fieldset>
            <div className="demo-item-authoring-field"><label className="demo-item-authoring-label" htmlFor="demo-item-sales-experience-type">Sales Experience type</label><select id="demo-item-sales-experience-type" className="demo-item-authoring-control" aria-label="Sales Experience type" value={salesExperienceType} onChange={(event) => setSalesExperienceType(event.target.value as DemoItem["salesExperienceType"])}><option value="demo">Demo</option><option value="poc">POC</option><option value="pov">POV</option><option value="trial">Trial</option></select></div>
          </div>
          <div className="demo-item-authoring-actions"><button type="submit" style={primaryButtonStyle} disabled={loading}>{view === "edit" ? "Save Demo Item changes" : "Save Demo Item"}</button></div>
          {error ? <p role="alert" style={{ margin: 0 }}>{error}</p> : null}{diagnostic ? <pre aria-label="Support diagnostics">{JSON.stringify(diagnostic, null, 2)}</pre> : null}
        </form>
      </section>
    </> : null}
    {view === "detail" ? <section aria-label="Demo Item inspection" style={{ ...mutedPanelStyle, display: "grid", gap: "0.75rem" }}><button type="button" style={compactButtonStyle} onClick={() => onNavigate({ tab: "demo-items", demoItemView: "catalog" })}>Back to catalog</button>{inspected ? <><h2 style={{ margin: 0 }}>{inspected.name}</h2><p style={{ margin: 0 }}>{inspected.description}</p><p style={{ margin: 0 }}>{inspected.blueprints.map((blueprint) => blueprint.name).join(" → ")} · {inspected.policy.name} · {inspected.region.name} · {inspected.defaultDurationMinutes} min · {inspected.salesExperienceType.toUpperCase()}</p><div style={{ display: "flex", gap: "0.5rem" }}><button type="button" onClick={() => onNavigate({ tab: "demo-items", demoItemView: "edit", demoItemId: inspected.id })}>Edit</button><button type="button" style={dangerButtonStyle} onClick={() => void archive(inspected.id)}>Archive</button></div></> : <p>Loading Demo Item details…</p>}{error ? <p role="alert">{error}</p> : null}{diagnostic ? <pre aria-label="Support diagnostics">{JSON.stringify(diagnostic, null, 2)}</pre> : null}</section> : null}
  </section>;
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
