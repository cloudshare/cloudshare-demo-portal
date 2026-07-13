"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createAdminAuthenticatedRequest } from "./admin-authenticated-request";
import { accountLogoutButtonStyle, compactButtonStyle, dangerButtonStyle, disabledButtonStyle, primaryButtonStyle } from "./button-styles";
import { cardStyle, mutedPanelStyle } from "./card-styles";
import { pageShellStyle } from "./page-shell";
import { PortalPageHeader } from "./portal-page-header";

type Account = { id: string; name: string; kind: "prospect" | "current_customer"; archivedAt: string | null; createdAt: string; updatedAt?: string };
type Opportunity = { id: string; accountId: string; name: string; status: "open" | "won" | "lost"; archivedAt: string | null; createdAt: string; updatedAt?: string };
type Contact = { id: string; opportunityId: string; firstName: string; lastName: string; email: string; archivedAt: string | null; createdAt: string; updatedAt?: string };
type SalesData = { accounts: Account[]; opportunities: Opportunity[]; contacts: Contact[] };
type SalesSelection = { accountId: string | null; opportunityId: string | null };
type Lifecycle = "active" | "archived" | "all";
type Sort = "name" | "created";
type Dialog = { kind: "account"; record?: Account } | { kind: "opportunity"; record?: Opportunity } | { kind: "contact"; record?: Contact } | null;

const blank: SalesData = { accounts: [], opportunities: [], contacts: [] };
const controlStyle = { padding: "0.55rem", border: "1px solid #b7bdc8", borderRadius: "6px", background: "#fff" };
const fullControlStyle = { ...controlStyle, width: "100%", minWidth: 0, boxSizing: "border-box" as const };
const salesWorkspaceStyle = { ...pageShellStyle, maxWidth: "96rem", margin: "0 auto", padding: "2rem clamp(1.25rem, 3vw, 3rem) 3rem" };
const tableStyle = { width: "100%", borderCollapse: "collapse" as const, tableLayout: "fixed" as const, minWidth: "66rem" };
const cellStyle = { padding: "0.7rem 0.65rem", borderBottom: "1px solid #e2e8f0", textAlign: "left" as const, verticalAlign: "middle" as const, whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" };
const actionCellStyle = { ...cellStyle, width: "9.5rem", textAlign: "right" as const };
const selectedRowStyle = { background: "#e8f5f3", boxShadow: "inset 4px 0 0 #0f6d66" };
const selectableRowStyle = { cursor: "pointer" };

export function SalesWorkspace({ email, initialSelection }: { readonly email: string; readonly initialSelection?: Partial<SalesSelection> }) {
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
    const params = new URLSearchParams();
    if (accountId) params.set("accountId", accountId);
    if (opportunityId) params.set("opportunityId", opportunityId);
    const href = `/sales${params.size ? `?${params.toString()}` : ""}`;
    setSelection({ accountId, opportunityId });
    window.history.replaceState(window.history.state, "", href);
    router.replace(href, { scroll: false });
  }, [router]);
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
  const logout = useCallback(async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }, [router]);

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

  return <main style={salesWorkspaceStyle}>
    <PortalPageHeader eyebrow="Certalis Sales Portal" title="Sales Workspace" description="A local, Customer-scoped commercial record workspace. No CRM sync or CloudShare Sales Experience operation is performed here." email={email} actions={<button onClick={() => void logout()} style={accountLogoutButtonStyle}>Log out</button>} />
    <section style={{ ...mutedPanelStyle, display: "flex", gap: "0.75rem", alignItems: "end", flexWrap: "wrap" }} aria-label="Sales workspace controls">
      <label style={{ display: "grid", gap: "0.3rem", flex: "1 1 22rem" }}>Search current view<input aria-label="Search current view" value={search} onChange={(event) => setSearch(event.target.value)} style={controlStyle} placeholder="Account, opportunity, or contact" /></label>
      <span style={{ color: "#52606d", fontSize: "0.9rem" }}>Select an Account, then an Opportunity, to work down the relationship.</span>
      {message ? <span role="status">{message}</span> : null}
      <a href="/sales/diagnostics">View Sales diagnostics</a>
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
  </main>;
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
