"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createAdminAuthenticatedRequest } from "./admin-authenticated-request";
import { accountLogoutButtonStyle, compactButtonStyle, dangerButtonStyle, primaryButtonStyle } from "./button-styles";
import { cardStyle, mutedPanelStyle } from "./card-styles";
import { pageShellStyle } from "./page-shell";
import { PortalPageHeader } from "./portal-page-header";

type Account = { id: string; name: string; kind: "prospect" | "current_customer"; archivedAt: string | null };
type Opportunity = { id: string; accountId: string; name: string; status: "open" | "won" | "lost"; archivedAt: string | null };
type Contact = { id: string; opportunityId: string; firstName: string; lastName: string; email: string };
type SalesData = { accounts: Account[]; opportunities: Opportunity[]; contacts: Contact[] };
const blank: SalesData = { accounts: [], opportunities: [], contacts: [] };
const controlStyle = { padding: "0.55rem", border: "1px solid #b7bdc8", borderRadius: "6px" };

export function SalesWorkspace({ email }: { readonly email: string }) {
  const router = useRouter();
  const browserFetch = useCallback<typeof fetch>((input, init) => window.fetch(input, init), []);
  const fetchSales = useMemo(() => createAdminAuthenticatedRequest({ fetchImpl: browserFetch, onSessionExpired: () => { router.replace("/login"); router.refresh(); } }), [browserFetch, router]);
  const [data, setData] = useState<SalesData>(blank);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (term = search) => {
    setLoading(true);
    try {
      const response = await fetchSales(`/api/sales/accounts${term ? `?search=${encodeURIComponent(term)}` : ""}`);
      const body = await response.json() as SalesData & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not load Sales records.");
      setData(body); setMessage(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load Sales records."); }
    finally { setLoading(false); }
  }, [fetchSales, search]);
  useEffect(() => { void load(""); }, [load]);

  const mutate = useCallback(async (url: string, method: "POST" | "PATCH", payload?: Record<string, unknown>) => {
    setLoading(true);
    try {
      const response = await fetchSales(url, { method, headers: payload ? { "content-type": "application/json" } : undefined, body: payload ? JSON.stringify(payload) : undefined });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not save Sales record.");
      await load(); setMessage("Saved."); return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save Sales record."); return false; }
    finally { setLoading(false); }
  }, [fetchSales, load]);
  const logout = useCallback(async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }, [router]);

  return <main style={pageShellStyle}>
    <PortalPageHeader eyebrow="Certalis Sales Portal" title="Sales Workspace" description="Organize durable commercial records before any Sales Demo Session is created." email={email} actions={<button onClick={() => void logout()} style={accountLogoutButtonStyle}>Log out</button>} />
    <section style={{ ...mutedPanelStyle, display: "flex", gap: "0.75rem", alignItems: "end", flexWrap: "wrap" }} aria-label="Search Sales records">
      <label style={{ display: "grid", gap: "0.3rem", flex: "1 1 18rem" }}>Search Accounts and Opportunities<input aria-label="Search Accounts and Opportunities" value={search} onChange={(event) => setSearch(event.target.value)} style={controlStyle} placeholder="Organization or opportunity" /></label>
      <button type="button" onClick={() => void load()} disabled={loading} style={compactButtonStyle}>Search</button>
      {message ? <span role="status">{message}</span> : null}
    </section>
    <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: "1rem", marginTop: "1rem" }}>
      <AccountPanel accounts={data.accounts} loading={loading} mutate={mutate} />
      <OpportunityPanel accounts={data.accounts} opportunities={data.opportunities} loading={loading} mutate={mutate} />
      <ContactPanel opportunities={data.opportunities} contacts={data.contacts} loading={loading} mutate={mutate} />
    </section>
  </main>;
}

function AccountPanel({ accounts, loading, mutate }: { accounts: Account[]; loading: boolean; mutate: (url: string, method: "POST" | "PATCH", payload?: Record<string, unknown>) => Promise<boolean> }) {
  const [name, setName] = useState(""); const [kind, setKind] = useState<Account["kind"]>("prospect");
  return <section style={{ ...cardStyle, display: "grid", gap: "0.75rem" }} aria-label="Accounts"><h2 style={{ margin: 0 }}>Accounts</h2><form onSubmit={(event) => { event.preventDefault(); void mutate("/api/sales/accounts", "POST", { name, kind }).then((saved) => { if (saved) setName(""); }); }} style={{ display: "grid", gap: "0.5rem" }}><label>Account name<input aria-label="Account name" required value={name} onChange={(event) => setName(event.target.value)} style={controlStyle} /></label><label>Account type<select aria-label="Account type" value={kind} onChange={(event) => setKind(event.target.value as Account["kind"])} style={controlStyle}><option value="prospect">Prospect</option><option value="current_customer">Current customer</option></select></label><button disabled={loading} style={primaryButtonStyle}>Create Account</button></form><RecordList empty="No Accounts yet." items={accounts} render={(account) => <AccountRow account={account} loading={loading} mutate={mutate} />} /></section>;
}
function AccountRow({ account, loading, mutate }: { account: Account; loading: boolean; mutate: (url: string, method: "POST" | "PATCH", payload?: Record<string, unknown>) => Promise<boolean> }) {
  const [name, setName] = useState(account.name); const [kind, setKind] = useState(account.kind);
  return <article style={mutedPanelStyle}><form onSubmit={(event) => { event.preventDefault(); void mutate(`/api/sales/accounts/${account.id}`, "PATCH", { name, kind }); }} style={{ display: "grid", gap: "0.4rem" }}><input aria-label={`Account ${account.name} name`} value={name} onChange={(event) => setName(event.target.value)} style={controlStyle} /><select aria-label={`Account ${account.name} type`} value={kind} onChange={(event) => setKind(event.target.value as Account["kind"])} style={controlStyle}><option value="prospect">Prospect</option><option value="current_customer">Current customer</option></select><span>{account.archivedAt ? "Archived" : "Active"}</span><div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}><button disabled={loading} style={compactButtonStyle}>Save Account</button>{!account.archivedAt ? <button type="button" disabled={loading} onClick={() => void mutate(`/api/sales/accounts/${account.id}/archive`, "POST")} style={dangerButtonStyle}>Archive Account</button> : null}</div></form></article>;
}

function OpportunityPanel({ accounts, opportunities, loading, mutate }: { accounts: Account[]; opportunities: Opportunity[]; loading: boolean; mutate: (url: string, method: "POST" | "PATCH", payload?: Record<string, unknown>) => Promise<boolean> }) {
  const activeAccounts = accounts.filter((account) => !account.archivedAt); const [accountId, setAccountId] = useState(""); const [name, setName] = useState(""); const [status, setStatus] = useState<Opportunity["status"]>("open");
  useEffect(() => { if (!accountId && activeAccounts[0]) setAccountId(activeAccounts[0].id); }, [accountId, activeAccounts]);
  return <section style={{ ...cardStyle, display: "grid", gap: "0.75rem" }} aria-label="Opportunities"><h2 style={{ margin: 0 }}>Opportunities</h2><form onSubmit={(event) => { event.preventDefault(); void mutate("/api/sales/opportunities", "POST", { accountId, name, status }).then((saved) => { if (saved) setName(""); }); }} style={{ display: "grid", gap: "0.5rem" }}><label>Account<select aria-label="Opportunity account" required value={accountId} onChange={(event) => setAccountId(event.target.value)} style={controlStyle}><option value="" disabled>Select an Account</option>{activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>Opportunity name<input aria-label="Opportunity name" required value={name} onChange={(event) => setName(event.target.value)} style={controlStyle} /></label><StatusSelect label="Opportunity status" value={status} onChange={setStatus} /><button disabled={loading || !accountId} style={primaryButtonStyle}>Create Opportunity</button></form><RecordList empty="No Opportunities yet." items={opportunities} render={(opportunity) => <OpportunityRow key={opportunity.id} opportunity={opportunity} accounts={accounts} loading={loading} mutate={mutate} />} /></section>;
}
function OpportunityRow({ opportunity, accounts, loading, mutate }: { opportunity: Opportunity; accounts: Account[]; loading: boolean; mutate: (url: string, method: "POST" | "PATCH", payload?: Record<string, unknown>) => Promise<boolean> }) {
  const [accountId, setAccountId] = useState(opportunity.accountId); const [name, setName] = useState(opportunity.name); const [status, setStatus] = useState(opportunity.status);
  return <article style={mutedPanelStyle}><form onSubmit={(event) => { event.preventDefault(); void mutate(`/api/sales/opportunities/${opportunity.id}`, "PATCH", { accountId, name, status }); }} style={{ display: "grid", gap: "0.4rem" }}><input aria-label={`Opportunity ${opportunity.name} name`} value={name} onChange={(event) => setName(event.target.value)} style={controlStyle} /><select aria-label={`Opportunity ${opportunity.name} account`} value={accountId} onChange={(event) => setAccountId(event.target.value)} style={controlStyle}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><StatusSelect label={`Opportunity ${opportunity.name} status`} value={status} onChange={setStatus} /><span>{opportunity.archivedAt ? "Archived" : "Active"}</span><div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}><button disabled={loading} style={compactButtonStyle}>Save Opportunity</button>{!opportunity.archivedAt ? <button type="button" disabled={loading} onClick={() => void mutate(`/api/sales/opportunities/${opportunity.id}/archive`, "POST")} style={dangerButtonStyle}>Archive Opportunity</button> : null}</div></form></article>;
}
function StatusSelect({ label, value, onChange }: { label: string; value: Opportunity["status"]; onChange: (value: Opportunity["status"]) => void }) { return <label>{label}<select aria-label={label} value={value} onChange={(event) => onChange(event.target.value as Opportunity["status"])} style={controlStyle}><option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option></select></label>; }

function ContactPanel({ opportunities, contacts, loading, mutate }: { opportunities: Opportunity[]; contacts: Contact[]; loading: boolean; mutate: (url: string, method: "POST" | "PATCH", payload?: Record<string, unknown>) => Promise<boolean> }) {
  const activeOpportunities = opportunities.filter((opportunity) => !opportunity.archivedAt); const [opportunityId, setOpportunityId] = useState(""); const [firstName, setFirstName] = useState(""); const [lastName, setLastName] = useState(""); const [email, setEmail] = useState("");
  useEffect(() => { if (!opportunityId && activeOpportunities[0]) setOpportunityId(activeOpportunities[0].id); }, [opportunityId, activeOpportunities]);
  return <section style={{ ...cardStyle, display: "grid", gap: "0.75rem" }} aria-label="Opportunity Contacts"><h2 style={{ margin: 0 }}>Opportunity Contacts</h2><form onSubmit={(event) => { event.preventDefault(); void mutate("/api/sales/contacts", "POST", { opportunityId, firstName, lastName, email }).then((saved) => { if (saved) { setFirstName(""); setLastName(""); setEmail(""); } }); }} style={{ display: "grid", gap: "0.5rem" }}><label>Opportunity<select aria-label="Contact opportunity" required value={opportunityId} onChange={(event) => setOpportunityId(event.target.value)} style={controlStyle}><option value="" disabled>Select an Opportunity</option>{activeOpportunities.map((opportunity) => <option key={opportunity.id} value={opportunity.id}>{opportunity.name}</option>)}</select></label><label>First name<input aria-label="Contact first name" required value={firstName} onChange={(event) => setFirstName(event.target.value)} style={controlStyle} /></label><label>Last name<input aria-label="Contact last name" required value={lastName} onChange={(event) => setLastName(event.target.value)} style={controlStyle} /></label><label>Email<input aria-label="Contact email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} style={controlStyle} /></label><button disabled={loading || !opportunityId} style={primaryButtonStyle}>Add Contact</button></form><RecordList empty="No Opportunity Contacts yet." items={contacts} render={(contact) => <ContactRow contact={contact} opportunities={opportunities} loading={loading} mutate={mutate} />} /></section>;
}
function ContactRow({ contact, opportunities, loading, mutate }: { contact: Contact; opportunities: Opportunity[]; loading: boolean; mutate: (url: string, method: "POST" | "PATCH", payload?: Record<string, unknown>) => Promise<boolean> }) {
  const [opportunityId, setOpportunityId] = useState(contact.opportunityId); const [firstName, setFirstName] = useState(contact.firstName); const [lastName, setLastName] = useState(contact.lastName); const [email, setEmail] = useState(contact.email);
  return <article style={mutedPanelStyle}><form onSubmit={(event) => { event.preventDefault(); void mutate(`/api/sales/contacts/${contact.id}`, "PATCH", { opportunityId, firstName, lastName, email }); }} style={{ display: "grid", gap: "0.4rem" }}><input aria-label={`Contact ${contact.email} first name`} value={firstName} onChange={(event) => setFirstName(event.target.value)} style={controlStyle} /><input aria-label={`Contact ${contact.email} last name`} value={lastName} onChange={(event) => setLastName(event.target.value)} style={controlStyle} /><input aria-label={`Contact ${contact.email} email`} type="email" value={email} onChange={(event) => setEmail(event.target.value)} style={controlStyle} /><select aria-label={`Contact ${contact.email} opportunity`} value={opportunityId} onChange={(event) => setOpportunityId(event.target.value)} style={controlStyle}>{opportunities.map((opportunity) => <option key={opportunity.id} value={opportunity.id}>{opportunity.name}</option>)}</select><button disabled={loading} style={compactButtonStyle}>Save Contact</button></form></article>;
}
function RecordList<T>({ items, empty, render }: { items: T[]; empty: string; render: (item: T) => React.ReactNode }) { return <div style={{ display: "grid", gap: "0.6rem" }}>{items.length ? items.map((item, index) => <React.Fragment key={index}>{render(item)}</React.Fragment>) : <p style={{ margin: 0 }}>{empty}</p>}</div>; }
