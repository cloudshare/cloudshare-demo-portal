import { randomUUID } from "node:crypto";
import type { AuditRepository } from "@/domain/audit-trail";
import type { DiagnosticActor, DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { AccountKind, OpportunityStatus, SalesRecordRepository } from "@/domain/sales-records";
import type { Logger } from "@/observability/logger";

export interface SalesRecordsDeps {
  readonly records: SalesRecordRepository;
  readonly audit: Pick<AuditRepository, "write">;
  readonly diagnostics: DiagnosticRecorder;
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

interface SalesRequest {
  readonly customerId: string;
  readonly actor: DiagnosticActor;
}
export interface SalesResponse { readonly status: number; readonly body: Record<string, unknown>; }

export async function handleListSalesRecords(
  deps: SalesRecordsDeps,
  request: SalesRequest & { readonly search?: string },
): Promise<SalesResponse> {
  const [accounts, opportunities, contacts] = await Promise.all([
    deps.records.listAccounts(request.customerId, request.search),
    deps.records.listOpportunities(request.customerId, request.search),
    deps.records.listContacts(request.customerId),
  ]);
  return { status: 200, body: { accounts: serialise(accounts), opportunities: serialise(opportunities), contacts: serialise(contacts) } };
}

export async function handleCreateSalesAccount(deps: SalesRecordsDeps, request: SalesRequest & { readonly body: unknown }): Promise<SalesResponse> {
  const input = parseAccount(request.body);
  if (!input) return badRequest("Account name and kind (prospect or current_customer) are required.");
  const now = currentTime(deps);
  const account = { id: newId(deps), customerId: request.customerId, ...input, archivedAt: null, createdAt: now, updatedAt: now };
  await deps.records.saveAccount(account);
  await recordMutation(deps, request, "account.created", "account", account.id, { name: account.name, kind: account.kind });
  return { status: 201, body: { account: serialise(account) } };
}

export async function handleUpdateSalesAccount(deps: SalesRecordsDeps, request: SalesRequest & { readonly accountId: string; readonly body: unknown }): Promise<SalesResponse> {
  const existing = await deps.records.findAccount(request.customerId, request.accountId);
  if (!existing) return notFound("account");
  const input = parseAccount(request.body);
  if (!input) return badRequest("Account name and kind (prospect or current_customer) are required.");
  const account = { ...existing, ...input, updatedAt: currentTime(deps) };
  await deps.records.saveAccount(account);
  await recordMutation(deps, request, "account.updated", "account", account.id, { name: account.name, kind: account.kind });
  return { status: 200, body: { account: serialise(account) } };
}

export async function handleArchiveSalesAccount(deps: SalesRecordsDeps, request: SalesRequest & { readonly accountId: string }): Promise<SalesResponse> {
  const existing = await deps.records.findAccount(request.customerId, request.accountId);
  if (!existing) return notFound("account");
  const now = currentTime(deps);
  const account = { ...existing, archivedAt: existing.archivedAt ?? now, updatedAt: now };
  await deps.records.saveAccount(account);
  await recordMutation(deps, request, "account.archived", "account", account.id, { archivedAt: account.archivedAt.toISOString() });
  return { status: 200, body: { account: serialise(account) } };
}

export async function handleCreateSalesOpportunity(deps: SalesRecordsDeps, request: SalesRequest & { readonly body: unknown }): Promise<SalesResponse> {
  const input = parseOpportunity(request.body);
  if (!input) return badRequest("Opportunity accountId, name, and status (open, won, or lost) are required.");
  const account = await deps.records.findAccount(request.customerId, input.accountId);
  if (!account) return notFound("account");
  const now = currentTime(deps);
  const opportunity = { id: newId(deps), customerId: request.customerId, ...input, archivedAt: null, createdAt: now, updatedAt: now };
  await deps.records.saveOpportunity(opportunity);
  await recordMutation(deps, request, "opportunity.created", "opportunity", opportunity.id, { accountId: opportunity.accountId, name: opportunity.name, status: opportunity.status });
  return { status: 201, body: { opportunity: serialise(opportunity) } };
}

export async function handleUpdateSalesOpportunity(deps: SalesRecordsDeps, request: SalesRequest & { readonly opportunityId: string; readonly body: unknown }): Promise<SalesResponse> {
  const existing = await deps.records.findOpportunity(request.customerId, request.opportunityId);
  if (!existing) return notFound("opportunity");
  const input = parseOpportunity(request.body);
  if (!input) return badRequest("Opportunity accountId, name, and status (open, won, or lost) are required.");
  if (!await deps.records.findAccount(request.customerId, input.accountId)) return notFound("account");
  const opportunity = { ...existing, ...input, updatedAt: currentTime(deps) };
  await deps.records.saveOpportunity(opportunity);
  await recordMutation(deps, request, "opportunity.updated", "opportunity", opportunity.id, { accountId: opportunity.accountId, name: opportunity.name, status: opportunity.status });
  return { status: 200, body: { opportunity: serialise(opportunity) } };
}

export async function handleArchiveSalesOpportunity(deps: SalesRecordsDeps, request: SalesRequest & { readonly opportunityId: string }): Promise<SalesResponse> {
  const existing = await deps.records.findOpportunity(request.customerId, request.opportunityId);
  if (!existing) return notFound("opportunity");
  const now = currentTime(deps);
  const opportunity = { ...existing, archivedAt: existing.archivedAt ?? now, updatedAt: now };
  await deps.records.saveOpportunity(opportunity);
  await recordMutation(deps, request, "opportunity.archived", "opportunity", opportunity.id, { archivedAt: opportunity.archivedAt.toISOString() });
  return { status: 200, body: { opportunity: serialise(opportunity) } };
}

export async function handleCreateOpportunityContact(deps: SalesRecordsDeps, request: SalesRequest & { readonly body: unknown }): Promise<SalesResponse> {
  const input = parseContact(request.body);
  if (!input) return badRequest("Contact opportunityId, first name, last name, and email are required.");
  if (!await deps.records.findOpportunity(request.customerId, input.opportunityId)) return notFound("opportunity");
  const now = currentTime(deps);
  const contact = { id: newId(deps), customerId: request.customerId, ...input, createdAt: now, updatedAt: now };
  await deps.records.saveContact(contact);
  await recordMutation(deps, request, "opportunity_contact.created", "opportunity_contact", contact.id, { opportunityId: contact.opportunityId, email: contact.email });
  return { status: 201, body: { contact: serialise(contact) } };
}

export async function handleUpdateOpportunityContact(deps: SalesRecordsDeps, request: SalesRequest & { readonly contactId: string; readonly body: unknown }): Promise<SalesResponse> {
  const existing = await deps.records.findContact(request.customerId, request.contactId);
  if (!existing) return notFound("opportunity contact");
  const input = parseContact(request.body);
  if (!input) return badRequest("Contact opportunityId, first name, last name, and email are required.");
  if (!await deps.records.findOpportunity(request.customerId, input.opportunityId)) return notFound("opportunity");
  const contact = { ...existing, ...input, updatedAt: currentTime(deps) };
  await deps.records.saveContact(contact);
  await recordMutation(deps, request, "opportunity_contact.updated", "opportunity_contact", contact.id, { opportunityId: contact.opportunityId, email: contact.email });
  return { status: 200, body: { contact: serialise(contact) } };
}

function parseAccount(body: unknown): { name: string; kind: AccountKind } | null {
  const record = asRecord(body); const name = stringField(record?.name); const kind = record?.kind;
  return name && (kind === "prospect" || kind === "current_customer") ? { name, kind } : null;
}
function parseOpportunity(body: unknown): { accountId: string; name: string; status: OpportunityStatus } | null {
  const record = asRecord(body); const accountId = stringField(record?.accountId); const name = stringField(record?.name); const status = record?.status;
  return accountId && name && (status === "open" || status === "won" || status === "lost") ? { accountId, name, status } : null;
}
function parseContact(body: unknown): { opportunityId: string; firstName: string; lastName: string; email: string } | null {
  const record = asRecord(body); const opportunityId = stringField(record?.opportunityId); const firstName = stringField(record?.firstName); const lastName = stringField(record?.lastName); const email = stringField(record?.email)?.toLowerCase();
  return opportunityId && firstName && lastName && email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { opportunityId, firstName, lastName, email } : null;
}
function asRecord(value: unknown): Record<string, unknown> | null { return typeof value === "object" && value !== null ? value as Record<string, unknown> : null; }
function stringField(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function currentTime(deps: SalesRecordsDeps): Date { return (deps.now ?? (() => new Date()))(); }
function newId(deps: SalesRecordsDeps): string { return (deps.newId ?? randomUUID)(); }
function serialise<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function badRequest(error: string): SalesResponse { return { status: 400, body: { error } }; }
function notFound(subject: string): SalesResponse { return { status: 404, body: { error: `${subject} not found` } }; }

async function recordMutation(deps: SalesRecordsDeps, request: SalesRequest, action: string, subjectType: string, subjectId: string, details: Record<string, unknown>): Promise<void> {
  const occurredAt = currentTime(deps);
  try {
    await Promise.all([
      deps.audit.write({ id: newId(deps), occurredAt, customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action, subjectType, subjectId, outcome: "success", details }),
      deps.diagnostics.record({ source: "sales-records", operation: action, outcome: "success", level: "info", customerId: request.customerId, actor: request.actor, subject: { type: subjectType, id: subjectId }, message: `Sales ${action} completed`, details: { integrationSurface: "local_sales_records", ...details } }),
    ]);
  } catch (error) {
    deps.logger.warn("sales record evidence append failed", { action, subjectType, subjectId, error: error instanceof Error ? error.message : String(error) });
  }
}
