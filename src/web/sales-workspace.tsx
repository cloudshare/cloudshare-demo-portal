"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createAdminAuthenticatedRequest } from "./admin-authenticated-request";
import { accountLogoutButtonStyle, compactButtonStyle, dangerButtonStyle, primaryButtonStyle } from "./button-styles";
import { cardStyle, mutedPanelStyle } from "./card-styles";
import { pageShellStyle } from "./page-shell";
import { PortalPageHeader } from "./portal-page-header";

type Account = { id: string; name: string; kind: "prospect" | "current_customer"; archivedAt: string | null; createdAt: string; updatedAt?: string };
type Opportunity = { id: string; accountId: string; name: string; status: "open" | "won" | "lost"; archivedAt: string | null; createdAt: string; updatedAt?: string };
type Contact = { id: string; opportunityId: string; firstName: string; lastName: string; email: string; archivedAt: string | null; createdAt: string; updatedAt?: string };
type SalesData = { accounts: Account[]; opportunities: Opportunity[]; contacts: Contact[] };
type Lifecycle = "active" | "archived" | "all";
type Sort = "name" | "created";
type Dialog = { kind: "account"; record?: Account } | { kind: "opportunity"; record?: Opportunity } | { kind: "contact"; record?: Contact } | null;
const blank: SalesData = { accounts: [], opportunities: [], contacts: [] };
const controlStyle = { padding: "0.55rem", border: "1px solid #b7bdc8", borderRadius: "6px", background: "#fff" };
const tableStyle = { width: "100%", borderCollapse: "collapse" as const, minWidth: "46rem" };
const cellStyle = { padding: "0.7rem 0.65rem", borderBottom: "1px solid #e2e8f0", textAlign: "left" as const, verticalAlign: "middle" };

export function SalesWorkspace({ email }: { readonly email: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selection, setSelection] = useState(() => ({ accountId: searchParams.get("accountId"), opportunityId: searchParams.get("opportunityId") }));
  const browserFetch = useCallback<typeof fetch>((input, init) => window.fetch(input, init), []);
  const fetchSales = useMemo(() => createAdminAuthenticatedRequest({ fetchImpl: browserFetch, onSessionExpired: () => { router.replace("/login"); router.refresh(); } }), [browserFetch, router]);
  const [data, setData] = useState<SalesData>(blank);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [filters, setFilters] = useState<{ account: Lifecycle; opportunity: Lifecycle; contact: Lifecycle }>({ account: "active", opportunity: "active", contact: "active" });
  const [sorts, setSorts] = useState<{ account: Sort; opportunity: Sort; contact: Sort }>({ account: "name", opportunity: "name", contact: "name" });

  useEffect(() => {
    setSelection({ accountId: searchParams.get("accountId"), opportunityId: searchParams.get("opportunityId") });
  }, [searchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchSales("/api/sales/accounts");
      const body = await response.json() as SalesData & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not load Sales records.");
      setData(body); setMessage(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load Sales records."); }
    finally { setLoading(false); setHasLoaded(true); }
  }, [fetchSales]);
  useEffect(() => { void load(); }, [load]);

  const updateSelection = useCallback((accountId: string | null, opportunityId: string | null) => {
    const params = new URLSearchParams();
    if (accountId) params.set("accountId", accountId);
    if (opportunityId) params.set("opportunityId", opportunityId);
    const suffix = params.toString();
    router.replace(`/sales${suffix ? `?${suffix}` : ""}`);
    setSelection({ accountId, opportunityId });
  }, [router]);
  const mutate = useCallback(async (url: string, method: "POST" | "PATCH", payload?: Record<string, unknown>) => {
    setLoading(true);
    try {
      const response = await fetchSales(url, { method, headers: payload ? { "content-type": "application/json" } : undefined, body: payload ? JSON.stringify(payload) : undefined });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not save Sales record.");
      await load(); setMessage("Saved."); setDialog(null); return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save Sales record."); return false; }
    finally { setLoading(false); }
  }, [fetchSales, load]);
  const logout = useCallback(async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }, [router]);

  const matchesSearch = useCallback((values: string[]) => !search.trim() || values.join(" ").toLowerCase().includes(search.trim().toLowerCase()), [search]);
  const selectedAccount = data.accounts.find((record) => record.id === selection.accountId) ?? null;
  const selectedOpportunity = selectedAccount
    ? data.opportunities.find((record) => record.id === selection.opportunityId && record.accountId === selectedAccount.id) ?? null
    : null;
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

  return <main style={pageShellStyle}>
    <PortalPageHeader eyebrow="Certalis Sales Portal" title="Sales Workspace" description="A local, Customer-scoped commercial record workspace. No CRM sync or CloudShare Sales Experience operation is performed here." email={email} actions={<button onClick={() => void logout()} style={accountLogoutButtonStyle}>Log out</button>} />
    <section style={{ ...mutedPanelStyle, display: "flex", gap: "0.75rem", alignItems: "end", flexWrap: "wrap" }} aria-label="Sales workspace controls">
      <label style={{ display: "grid", gap: "0.3rem", flex: "1 1 22rem" }}>Search current view<input aria-label="Search current view" value={search} onChange={(event) => setSearch(event.target.value)} style={controlStyle} placeholder="Account, opportunity, or contact" /></label>
      <span style={{ color: "#52606d", fontSize: "0.9rem" }}>Select an Account, then an Opportunity, to work down the relationship.</span>
      {message ? <span role="status">{message}</span> : null}
      <a href="/api/admin/diagnostics?source=sales-records">View Sales diagnostics</a>
    </section>
    <div style={{ display: "grid", gap: "1rem", marginTop: "1rem" }}>
      <RecordGrid title="Accounts" count={accounts.length} lifecycle={filters.account} sort={sorts.account} onLifecycle={(value) => setFilters((current) => ({ ...current, account: value }))} onSort={(value) => setSorts((current) => ({ ...current, account: value }))} addLabel="New Account" onAdd={() => setDialog({ kind: "account" })}>
        <thead><tr><th style={cellStyle}>Account</th><th style={cellStyle}>Type</th><th style={cellStyle}>Created (UTC)</th><th style={cellStyle}>Archived (UTC)</th><th style={cellStyle}>Actions</th></tr></thead>
        <tbody>{accounts.map((record) => <tr key={record.id} style={record.id === selectedAccount?.id ? { background: "#e8f5f3" } : undefined}><td style={cellStyle}><button type="button" onClick={() => updateSelection(record.id, null)} style={linkButtonStyle} aria-label={`Select ${record.name}`}>{record.name}</button></td><td style={cellStyle}>{labelAccountKind(record.kind)}</td><td style={cellStyle}>{formatUtc(record.createdAt)}</td><td style={cellStyle}>{formatUtc(record.archivedAt)}</td><td style={cellStyle}><RowActions editLabel={`Edit ${record.name}`} onEdit={() => setDialog({ kind: "account", record })} archiveLabel="Archive Account" archived={Boolean(record.archivedAt)} loading={loading} onArchive={() => void mutate(`/api/sales/accounts/${record.id}/archive`, "POST")} /></td></tr>)}</tbody>
      </RecordGrid>
      <RecordGrid title="Opportunities" context={selectedAccount ? `Account: ${selectedAccount.name}` : "Select an Account to view its Opportunities"} count={opportunities.length} lifecycle={filters.opportunity} sort={sorts.opportunity} onLifecycle={(value) => setFilters((current) => ({ ...current, opportunity: value }))} onSort={(value) => setSorts((current) => ({ ...current, opportunity: value }))} addLabel="New Opportunity" disabled={!selectedAccount || Boolean(selectedAccount.archivedAt)} onAdd={() => setDialog({ kind: "opportunity" })}>
        <thead><tr><th style={cellStyle}>Opportunity</th><th style={cellStyle}>Status</th><th style={cellStyle}>Created (UTC)</th><th style={cellStyle}>Archived (UTC)</th><th style={cellStyle}>Actions</th></tr></thead>
        <tbody>{opportunities.map((record) => <tr key={record.id} style={record.id === selectedOpportunity?.id ? { background: "#e8f5f3" } : undefined}><td style={cellStyle}><button type="button" onClick={() => updateSelection(record.accountId, record.id)} style={linkButtonStyle} aria-label={`Select ${record.name}`}>{record.name}</button></td><td style={cellStyle}>{labelStatus(record.status)}</td><td style={cellStyle}>{formatUtc(record.createdAt)}</td><td style={cellStyle}>{formatUtc(record.archivedAt)}</td><td style={cellStyle}><RowActions editLabel={`Edit ${record.name}`} onEdit={() => setDialog({ kind: "opportunity", record })} archiveLabel="Archive Opportunity" archived={Boolean(record.archivedAt)} loading={loading} onArchive={() => void mutate(`/api/sales/opportunities/${record.id}/archive`, "POST")} /></td></tr>)}</tbody>
      </RecordGrid>
      <RecordGrid title="Opportunity Contacts" context={selectedOpportunity ? `Opportunity: ${selectedOpportunity.name}` : "Select an Opportunity to view its Contacts"} count={contacts.length} lifecycle={filters.contact} sort={sorts.contact} onLifecycle={(value) => setFilters((current) => ({ ...current, contact: value }))} onSort={(value) => setSorts((current) => ({ ...current, contact: value }))} addLabel="New Contact" disabled={!selectedOpportunity || Boolean(selectedOpportunity.archivedAt)} onAdd={() => setDialog({ kind: "contact" })}>
        <thead><tr><th style={cellStyle}>Contact</th><th style={cellStyle}>Email</th><th style={cellStyle}>Created (UTC)</th><th style={cellStyle}>Archived (UTC)</th><th style={cellStyle}>Actions</th></tr></thead>
        <tbody>{contacts.map((record) => <tr key={record.id}><td style={cellStyle}>{record.firstName} {record.lastName}</td><td style={cellStyle}>{record.email}</td><td style={cellStyle}>{formatUtc(record.createdAt)}</td><td style={cellStyle}>{formatUtc(record.archivedAt)}</td><td style={cellStyle}><RowActions editLabel={`Edit ${record.email}`} onEdit={() => setDialog({ kind: "contact", record })} archiveLabel="Archive Contact" archived={Boolean(record.archivedAt)} loading={loading} onArchive={() => void mutate(`/api/sales/contacts/${record.id}/archive`, "POST")} /></td></tr>)}</tbody>
      </RecordGrid>
    </div>
    {dialog ? <RecordDialog dialog={dialog} selectedAccount={selectedAccount} selectedOpportunity={selectedOpportunity} accounts={data.accounts} opportunities={data.opportunities} loading={loading} onClose={() => setDialog(null)} onSave={mutate} /> : null}
  </main>;
}

function RecordGrid({ title, context, count, lifecycle, sort, onLifecycle, onSort, addLabel, disabled, onAdd, children }: { title: string; context?: string; count: number; lifecycle: Lifecycle; sort: Sort; onLifecycle: (value: Lifecycle) => void; onSort: (value: Sort) => void; addLabel: string; disabled?: boolean; onAdd: () => void; children: React.ReactNode }) {
  return <section style={{ ...cardStyle, padding: "1.1rem" }} aria-label={title}><div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.8rem" }}><div><h2 style={{ margin: 0 }}>{title}</h2><p style={{ margin: "0.25rem 0 0", color: "#52606d" }}>{context ?? `${count} record${count === 1 ? "" : "s"} shown`}</p></div><div style={{ display: "flex", alignItems: "end", gap: "0.5rem", flexWrap: "wrap" }}><label style={{ display: "grid", gap: "0.2rem", fontSize: "0.85rem" }}>View<select aria-label={`${title} lifecycle`} value={lifecycle} onChange={(event) => onLifecycle(event.target.value as Lifecycle)} style={controlStyle}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></select></label><label style={{ display: "grid", gap: "0.2rem", fontSize: "0.85rem" }}>Sort<select aria-label={`${title} sort`} value={sort} onChange={(event) => onSort(event.target.value as Sort)} style={controlStyle}><option value="name">Name</option><option value="created">Created date</option></select></label><button type="button" style={primaryButtonStyle} disabled={disabled} onClick={onAdd}>{addLabel}</button></div></div><div style={{ overflowX: "auto" }}><table style={tableStyle}>{children}</table></div><p style={{ color: "#52606d", fontSize: "0.85rem", margin: "0.7rem 0 0" }}>Showing {count} record{count === 1 ? "" : "s"} · Page 1 · ready for pagination</p></section>;
}

function RowActions({ editLabel, onEdit, archiveLabel, archived, loading, onArchive }: { editLabel: string; onEdit: () => void; archiveLabel: string; archived: boolean; loading: boolean; onArchive: () => void }) {
  return <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}><button type="button" style={compactButtonStyle} disabled={loading} onClick={onEdit}>{editLabel}</button>{!archived ? <button type="button" style={dangerButtonStyle} disabled={loading} onClick={onArchive}>{archiveLabel}</button> : <span style={{ color: "#52606d" }}>Archived</span>}</div>;
}

function RecordDialog({ dialog, selectedAccount, selectedOpportunity, accounts, opportunities, loading, onClose, onSave }: { dialog: Exclude<Dialog, null>; selectedAccount: Account | null; selectedOpportunity: Opportunity | null; accounts: Account[]; opportunities: Opportunity[]; loading: boolean; onClose: () => void; onSave: (url: string, method: "POST" | "PATCH", payload?: Record<string, unknown>) => Promise<boolean> }) {
  const dialogRef = useRef<HTMLDivElement>(null);
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
  const submit = (event: React.FormEvent) => { event.preventDefault(); if (dialog.kind === "account") void onSave(accountRecord ? `/api/sales/accounts/${accountRecord.id}` : "/api/sales/accounts", accountRecord ? "PATCH" : "POST", { name, kind }); if (dialog.kind === "opportunity") void onSave(opportunityRecord ? `/api/sales/opportunities/${opportunityRecord.id}` : "/api/sales/opportunities", opportunityRecord ? "PATCH" : "POST", { accountId, name, status }); if (dialog.kind === "contact") void onSave(contactRecord ? `/api/sales/contacts/${contactRecord.id}` : "/api/sales/contacts", contactRecord ? "PATCH" : "POST", { opportunityId, firstName, lastName, email }); };
  const title = `${isEdit ? "Edit" : "New"} ${dialog.kind === "contact" ? "Contact" : dialog.kind[0].toUpperCase() + dialog.kind.slice(1)}`;
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled])") ?? []);
    focusable().find((element) => element.hasAttribute("autofocus"))?.focus();
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
    return () => { document.removeEventListener("keydown", handleKeyDown); previousFocus?.focus(); };
  }, [onClose]);
  return <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.45)", display: "grid", placeItems: "center", zIndex: 20, padding: "1rem" }}><form onSubmit={submit} style={{ ...cardStyle, width: "min(34rem, 100%)", display: "grid", gap: "0.85rem", boxShadow: "0 20px 45px rgba(15, 23, 42, 0.25)" }}><div><h2 style={{ margin: 0 }}>{title}</h2><p style={{ margin: "0.25rem 0 0", color: "#52606d" }}>Changes are kept locally for this Customer and leave audit and diagnostic evidence.</p></div>{dialog.kind === "account" ? <><label>Account name<input autoFocus required value={name} onChange={(event) => setName(event.target.value)} style={controlStyle} /></label><label>Account type<select value={kind} onChange={(event) => setKind(event.target.value as Account["kind"])} style={controlStyle}><option value="prospect">Prospect</option><option value="current_customer">Current customer</option></select></label></> : null}{dialog.kind === "opportunity" ? <><label>Account<select required value={accountId} onChange={(event) => setAccountId(event.target.value)} style={controlStyle}>{accounts.filter((account) => !account.archivedAt || account.id === accountId).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>Opportunity name<input autoFocus required value={name} onChange={(event) => setName(event.target.value)} style={controlStyle} /></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value as Opportunity["status"])} style={controlStyle}><option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option></select></label></> : null}{dialog.kind === "contact" ? <><label>Opportunity<select required value={opportunityId} onChange={(event) => setOpportunityId(event.target.value)} style={controlStyle}>{opportunities.filter((opportunity) => !opportunity.archivedAt || opportunity.id === opportunityId).map((opportunity) => <option key={opportunity.id} value={opportunity.id}>{opportunity.name}</option>)}</select></label><label>First name<input autoFocus required value={firstName} onChange={(event) => setFirstName(event.target.value)} style={controlStyle} /></label><label>Last name<input required value={lastName} onChange={(event) => setLastName(event.target.value)} style={controlStyle} /></label><label>Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} style={controlStyle} /></label></> : null}<div style={{ display: "flex", justifyContent: "end", gap: "0.6rem" }}><button type="button" style={compactButtonStyle} onClick={onClose}>Cancel</button><button disabled={loading} style={primaryButtonStyle}>{isEdit ? "Save changes" : `Create ${dialog.kind === "contact" ? "Contact" : dialog.kind[0].toUpperCase() + dialog.kind.slice(1)}`}</button></div></form></div>;
}

function visible<T extends { archivedAt: string | null; createdAt: string }>(records: T[], lifecycle: Lifecycle, sort: Sort, name: (record: T) => string): T[] { return records.filter((record) => lifecycle === "all" || (lifecycle === "archived" ? Boolean(record.archivedAt) : !record.archivedAt)).sort((left, right) => sort === "created" ? right.createdAt.localeCompare(left.createdAt) : name(left).localeCompare(name(right))); }
function formatUtc(value: string | null): string { return value ? `${value.slice(0, 19).replace("T", " ")} UTC` : "—"; }
function labelAccountKind(value: Account["kind"]): string { return value === "current_customer" ? "Current customer" : "Prospect"; }
function labelStatus(value: Opportunity["status"]): string { return value[0].toUpperCase() + value.slice(1); }
const linkButtonStyle = { border: 0, padding: 0, background: "transparent", color: "#075e54", textDecoration: "underline", fontWeight: 700, cursor: "pointer", textAlign: "left" as const };
