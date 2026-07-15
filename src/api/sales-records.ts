import { randomUUID } from "node:crypto";
import type { DiagnosticActor, DiagnosticLogEntryInput } from "@/domain/diagnostic-log";
import type { AccountKind, OpportunityStatus, SalesRecordRepository } from "@/domain/sales-records";
import type { ActiveSalesParentGuard, ActiveSalesRecordGuard, SalesMutationRecord, SalesMutationWriter } from "@/domain/sales-mutation-writer";
import type { Logger } from "@/observability/logger";

export interface SalesRecordsDeps {
  readonly records: SalesRecordRepository;
  readonly writer: SalesMutationWriter;
  readonly redactDiagnostic: (input: DiagnosticLogEntryInput) => DiagnosticLogEntryInput;
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
  if (await persistMutation(deps, request, "account.created", "account", account.id, { name: account.name, kind: account.kind }, { type: "account", value: account }) !== "committed") return evidenceUnavailable();
  return { status: 201, body: { account: serialise(account) } };
}

export async function handleUpdateSalesAccount(deps: SalesRecordsDeps, request: SalesRequest & { readonly accountId: string; readonly body: unknown }): Promise<SalesResponse> {
  const existing = await deps.records.findAccount(request.customerId, request.accountId);
  if (!existing) return notFound("account");
  const input = parseAccount(request.body);
  if (!input) return badRequest("Account name and kind (prospect or current_customer) are required.");
  const account = { ...existing, ...input, updatedAt: currentTime(deps) };
  const result = await persistMutation(deps, request, "account.updated", "account", account.id, { name: account.name, kind: account.kind }, { type: "account", value: account }, undefined, existing.archivedAt ? undefined : activeRecordGuard(deps, request, "account.updated", "account", account.id));
  if (result === "record_archived") return archivedRecordConflict("account");
  if (result !== "committed") return evidenceUnavailable();
  return { status: 200, body: { account: serialise(account) } };
}

export async function handleArchiveSalesAccount(deps: SalesRecordsDeps, request: SalesRequest & { readonly accountId: string }): Promise<SalesResponse> {
  const existing = await deps.records.findAccount(request.customerId, request.accountId);
  if (!existing) return notFound("account");
  const now = currentTime(deps);
  const account = { ...existing, archivedAt: existing.archivedAt ?? now, updatedAt: now };
  if (await persistMutation(deps, request, "account.archived", "account", account.id, { archivedAt: account.archivedAt.toISOString() }, { type: "account", value: account }) !== "committed") return evidenceUnavailable();
  return { status: 200, body: { account: serialise(account) } };
}

export async function handleCreateSalesOpportunity(deps: SalesRecordsDeps, request: SalesRequest & { readonly body: unknown }): Promise<SalesResponse> {
  const input = parseOpportunity(request.body);
  if (!input) return badRequest("Opportunity accountId, name (up to 100 characters), and status (open, won, or lost) are required.");
  const account = await deps.records.findAccount(request.customerId, input.accountId);
  if (!account) return notFound("account");
  const now = currentTime(deps);
  const opportunity = { id: newId(deps), customerId: request.customerId, ...input, archivedAt: null, createdAt: now, updatedAt: now };
  const result = await persistMutation(deps, request, "opportunity.created", "opportunity", opportunity.id, { accountId: opportunity.accountId, name: opportunity.name, status: opportunity.status }, { type: "opportunity", value: opportunity }, activeParentGuard(deps, request, "opportunity.created", "account", account.id, "account"));
  if (result === "parent_archived") return archivedParentConflict("account");
  if (result !== "committed") return evidenceUnavailable();
  return { status: 201, body: { opportunity: serialise(opportunity) } };
}

export async function handleUpdateSalesOpportunity(deps: SalesRecordsDeps, request: SalesRequest & { readonly opportunityId: string; readonly body: unknown }): Promise<SalesResponse> {
  const existing = await deps.records.findOpportunity(request.customerId, request.opportunityId);
  if (!existing) return notFound("opportunity");
  const input = parseOpportunity(request.body);
  if (!input) return badRequest("Opportunity accountId, name (up to 100 characters), and status (open, won, or lost) are required.");
  const account = await deps.records.findAccount(request.customerId, input.accountId);
  if (!account) return notFound("account");
  const opportunity = { ...existing, ...input, updatedAt: currentTime(deps) };
  const result = await persistMutation(deps, request, "opportunity.updated", "opportunity", opportunity.id, { accountId: opportunity.accountId, name: opportunity.name, status: opportunity.status }, { type: "opportunity", value: opportunity }, existing.archivedAt && existing.accountId === input.accountId ? undefined : activeParentGuard(deps, request, "opportunity.updated", "opportunity", existing.id, "account", account.id), existing.archivedAt ? undefined : activeRecordGuard(deps, request, "opportunity.updated", "opportunity", opportunity.id));
  if (result === "parent_archived") return archivedParentConflict("account");
  if (result === "record_archived") return archivedRecordConflict("opportunity");
  if (result !== "committed") return evidenceUnavailable();
  return { status: 200, body: { opportunity: serialise(opportunity) } };
}

export async function handleArchiveSalesOpportunity(deps: SalesRecordsDeps, request: SalesRequest & { readonly opportunityId: string }): Promise<SalesResponse> {
  const existing = await deps.records.findOpportunity(request.customerId, request.opportunityId);
  if (!existing) return notFound("opportunity");
  const now = currentTime(deps);
  const opportunity = { ...existing, archivedAt: existing.archivedAt ?? now, updatedAt: now };
  if (await persistMutation(deps, request, "opportunity.archived", "opportunity", opportunity.id, { archivedAt: opportunity.archivedAt.toISOString() }, { type: "opportunity", value: opportunity }) !== "committed") return evidenceUnavailable();
  return { status: 200, body: { opportunity: serialise(opportunity) } };
}

export async function handleCreateOpportunityContact(deps: SalesRecordsDeps, request: SalesRequest & { readonly body: unknown }): Promise<SalesResponse> {
  const input = parseContact(request.body);
  if (!input) return badRequest("Contact opportunityId, first name, last name, and email are required.");
  const opportunity = await deps.records.findOpportunity(request.customerId, input.opportunityId);
  if (!opportunity) return notFound("opportunity");
  const now = currentTime(deps);
  const contact = { id: newId(deps), customerId: request.customerId, ...input, archivedAt: null, createdAt: now, updatedAt: now };
  const result = await persistMutation(deps, request, "opportunity_contact.created", "opportunity_contact", contact.id, { opportunityId: contact.opportunityId, email: contact.email }, { type: "opportunity_contact", value: contact }, activeParentGuard(deps, request, "opportunity_contact.created", "opportunity", opportunity.id, "opportunity"));
  if (result === "parent_archived") return archivedParentConflict("opportunity");
  if (result !== "committed") return evidenceUnavailable();
  return { status: 201, body: { contact: serialise(contact) } };
}

export async function handleUpdateOpportunityContact(deps: SalesRecordsDeps, request: SalesRequest & { readonly contactId: string; readonly body: unknown }): Promise<SalesResponse> {
  const existing = await deps.records.findContact(request.customerId, request.contactId);
  if (!existing) return notFound("opportunity contact");
  const input = parseContact(request.body);
  if (!input) return badRequest("Contact opportunityId, first name, last name, and email are required.");
  const opportunity = await deps.records.findOpportunity(request.customerId, input.opportunityId);
  if (!opportunity) return notFound("opportunity");
  const contact = { ...existing, ...input, updatedAt: currentTime(deps) };
  const result = await persistMutation(deps, request, "opportunity_contact.updated", "opportunity_contact", contact.id, { opportunityId: contact.opportunityId, email: contact.email }, { type: "opportunity_contact", value: contact }, existing.archivedAt && existing.opportunityId === input.opportunityId ? undefined : activeParentGuard(deps, request, "opportunity_contact.updated", "opportunity_contact", existing.id, "opportunity", opportunity.id), existing.archivedAt ? undefined : activeRecordGuard(deps, request, "opportunity_contact.updated", "opportunity_contact", contact.id));
  if (result === "parent_archived") return archivedParentConflict("opportunity");
  if (result === "record_archived") return archivedRecordConflict("opportunity contact");
  if (result !== "committed") return evidenceUnavailable();
  return { status: 200, body: { contact: serialise(contact) } };
}

export async function handleArchiveOpportunityContact(deps: SalesRecordsDeps, request: SalesRequest & { readonly contactId: string }): Promise<SalesResponse> {
  const existing = await deps.records.findContact(request.customerId, request.contactId);
  if (!existing) return notFound("opportunity contact");
  const now = currentTime(deps);
  const contact = { ...existing, archivedAt: existing.archivedAt ?? now, updatedAt: now };
  if (await persistMutation(deps, request, "opportunity_contact.archived", "opportunity_contact", contact.id, { archivedAt: contact.archivedAt.toISOString() }, { type: "opportunity_contact", value: contact }) !== "committed") return evidenceUnavailable();
  return { status: 200, body: { contact: serialise(contact) } };
}

function parseAccount(body: unknown): { name: string; kind: AccountKind } | null {
  const record = asRecord(body); const name = stringField(record?.name); const kind = record?.kind;
  return name && (kind === "prospect" || kind === "current_customer") ? { name, kind } : null;
}
function parseOpportunity(body: unknown): { accountId: string; name: string; status: OpportunityStatus } | null {
  const record = asRecord(body); const accountId = stringField(record?.accountId); const name = stringField(record?.name); const status = record?.status;
  return accountId && name && name.length <= 100 && (status === "open" || status === "won" || status === "lost") ? { accountId, name, status } : null;
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
function evidenceUnavailable(): SalesResponse { return { status: 503, body: { error: "The Sales record change could not be saved. Retry the operation or provide this support reference: sales-record-write-failed." } }; }
function archivedParentConflict(parentType: "account" | "opportunity"): SalesResponse { return { status: 409, body: { error: `Archived ${parentType} cannot accept new or reparented Sales records.` } }; }
function archivedRecordConflict(recordType: "account" | "opportunity" | "opportunity contact"): SalesResponse { return { status: 409, body: { error: `Archived ${recordType} cannot be updated.` } }; }

function activeParentGuard(
  deps: SalesRecordsDeps,
  request: SalesRequest,
  action: string,
  subjectType: string,
  subjectId: string,
  parentType: "account" | "opportunity",
  parentId = subjectId,
): ActiveSalesParentGuard {
  const correlationId = newId(deps);
  return {
    type: parentType,
    id: parentId,
    customerId: request.customerId,
    deniedAudit: { id: newId(deps), occurredAt: currentTime(deps), customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action, subjectType, subjectId, outcome: "denied", correlationId, details: { integrationSurface: "local_sales_records", reason: "parent_archived", parentType } },
    deniedDiagnostic: deps.redactDiagnostic({ source: "sales-records", operation: action, outcome: "failure", level: "warn", customerId: request.customerId, actor: request.actor, subject: { type: subjectType, id: subjectId }, message: `Sales ${action} denied because its ${parentType} is archived`, correlationId, details: { integrationSurface: "local_sales_records", reason: "parent_archived", parentType } }),
  };
}

function activeRecordGuard(
  deps: SalesRecordsDeps,
  request: SalesRequest,
  action: string,
  recordType: SalesMutationRecord["type"],
  recordId: string,
): ActiveSalesRecordGuard {
  const correlationId = newId(deps);
  const label = recordType === "opportunity_contact" ? "opportunity contact" : recordType;
  return {
    type: recordType,
    id: recordId,
    customerId: request.customerId,
    deniedAudit: { id: newId(deps), occurredAt: currentTime(deps), customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action, subjectType: recordType, subjectId: recordId, outcome: "denied", correlationId, details: { integrationSurface: "local_sales_records", reason: "record_archived" } },
    deniedDiagnostic: deps.redactDiagnostic({ source: "sales-records", operation: action, outcome: "failure", level: "warn", customerId: request.customerId, actor: request.actor, subject: { type: recordType, id: recordId }, message: `Sales ${action} denied because the ${label} was archived`, correlationId, details: { integrationSurface: "local_sales_records", reason: "record_archived" } }),
  };
}

async function persistMutation(
  deps: SalesRecordsDeps,
  request: SalesRequest,
  action: string,
  subjectType: string,
  subjectId: string,
  details: Record<string, unknown>,
  record: SalesMutationRecord,
  activeParentGuard?: ActiveSalesParentGuard,
  activeRecordGuard?: ActiveSalesRecordGuard,
): Promise<"committed" | "parent_archived" | "record_archived" | "failed"> {
  const correlationId = newId(deps);
  try {
    const result = await deps.writer.commit({
      record,
      audit: { id: newId(deps), occurredAt: currentTime(deps), customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action, subjectType, subjectId, outcome: "success", correlationId, details },
      diagnostic: deps.redactDiagnostic({ source: "sales-records", operation: action, outcome: "success", level: "info", customerId: request.customerId, actor: request.actor, subject: { type: subjectType, id: subjectId }, message: `Sales ${action} completed`, correlationId, details: { integrationSurface: "local_sales_records", ...details } }),
      activeParentGuard,
      activeRecordGuard,
    });
    return result.outcome;
  } catch (error) {
    deps.logger.error("sales record transaction failed", { action, subjectType, subjectId, correlationId, errorType: error instanceof Error ? error.name : typeof error });
    return "failed";
  }
}
