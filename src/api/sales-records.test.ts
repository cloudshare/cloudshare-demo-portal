import { describe, expect, it, vi } from "vitest";
import { createInMemoryAuditRepository } from "@/persistence/audit-repository";
import { createInMemorySalesRecordRepository } from "@/domain/sales-records";
import {
  handleArchiveSalesAccount,
  handleArchiveOpportunityContact,
  handleArchiveSalesOpportunity,
  handleCreateOpportunityContact,
  handleCreateSalesAccount,
  handleCreateSalesOpportunity,
  handleListSalesRecords,
  handleUpdateSalesAccount,
  handleUpdateOpportunityContact,
  handleUpdateSalesOpportunity,
  type SalesRecordsDeps,
} from "./sales-records";

function createDeps(): SalesRecordsDeps & { audit: ReturnType<typeof createInMemoryAuditRepository>; diagnostics: { append: ReturnType<typeof vi.fn> } } {
  let sequence = 0;
  const records = createInMemorySalesRecordRepository();
  const audit = createInMemoryAuditRepository();
  const diagnostics = { append: vi.fn().mockResolvedValue(undefined) };
  return {
    records,
    audit,
    diagnostics,
    writer: { async commit(input) {
      if (input.activeRecordGuard) {
        const record = input.activeRecordGuard.type === "account"
          ? await records.findAccount(input.activeRecordGuard.customerId, input.activeRecordGuard.id)
          : input.activeRecordGuard.type === "opportunity"
            ? await records.findOpportunity(input.activeRecordGuard.customerId, input.activeRecordGuard.id)
            : await records.findContact(input.activeRecordGuard.customerId, input.activeRecordGuard.id);
        if (!record || record.archivedAt) {
          await audit.write(input.activeRecordGuard.deniedAudit);
          await diagnostics.append(input.activeRecordGuard.deniedDiagnostic);
          return { outcome: "record_archived" } as const;
        }
      }
      if (input.activeParentGuard) {
        const parent = input.activeParentGuard.type === "account"
          ? await records.findAccount(input.activeParentGuard.customerId, input.activeParentGuard.id)
          : await records.findOpportunity(input.activeParentGuard.customerId, input.activeParentGuard.id);
        if (!parent || parent.archivedAt) {
          await audit.write(input.activeParentGuard.deniedAudit);
          await diagnostics.append(input.activeParentGuard.deniedDiagnostic);
          return { outcome: "parent_archived" } as const;
        }
      }
      if (input.record?.type === "account") await records.saveAccount(input.record.value);
      if (input.record?.type === "opportunity") await records.saveOpportunity(input.record.value);
      if (input.record?.type === "opportunity_contact") await records.saveContact(input.record.value);
      await audit.write(input.audit);
      await diagnostics.append(input.diagnostic);
      return { outcome: "committed" } as const;
    } },
    redactDiagnostic: (input) => input,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    now: () => new Date("2026-07-12T17:00:00.000Z"),
    newId: () => `record-${++sequence}`,
  };
}

const admin = { type: "admin", id: "sales-admin", email: "sales-admin@certalis.demo" };

describe("Customer-scoped Sales record API handlers", () => {
  it("creates an Account, moves its Opportunity through Won and archives it without deleting its Contact history", async () => {
    const deps = createDeps();
    const account = await handleCreateSalesAccount(deps, { customerId: "certalis", actor: admin, body: { name: "Acme Labs", kind: "prospect" } });
    const accountId = (account.body.account as { id: string }).id;
    const opportunity = await handleCreateSalesOpportunity(deps, { customerId: "certalis", actor: admin, body: { accountId, name: "Accelerate proof", status: "open" } });
    const opportunityId = (opportunity.body.opportunity as { id: string }).id;
    const updated = await handleUpdateSalesOpportunity(deps, { customerId: "certalis", actor: admin, opportunityId, body: { accountId, name: "Accelerate proof", status: "won" } });
    const contact = await handleCreateOpportunityContact(deps, { customerId: "certalis", actor: admin, body: { opportunityId, firstName: "Ada", lastName: "Lovelace", email: "ADA@ACME.TEST" } });
    const archived = await handleArchiveSalesOpportunity(deps, { customerId: "certalis", actor: admin, opportunityId });
    const history = await handleListSalesRecords(deps, { customerId: "certalis", actor: admin });

    expect(updated.body.opportunity).toMatchObject({ status: "won" });
    expect(archived.body.opportunity).toMatchObject({ archivedAt: "2026-07-12T17:00:00.000Z" });
    expect(contact.body.contact).toMatchObject({ email: "ada@acme.test" });
    expect(history.body).toMatchObject({ opportunities: [expect.objectContaining({ id: opportunityId, status: "won" })], contacts: [expect.objectContaining({ opportunityId })] });
  });

  it("archives a Contact as durable local history with audit and diagnostic evidence", async () => {
    const deps = createDeps();
    const account = await handleCreateSalesAccount(deps, { customerId: "certalis", actor: admin, body: { name: "Acme Labs", kind: "prospect" } });
    const opportunity = await handleCreateSalesOpportunity(deps, { customerId: "certalis", actor: admin, body: { accountId: (account.body.account as { id: string }).id, name: "Accelerate proof", status: "open" } });
    const contact = await handleCreateOpportunityContact(deps, { customerId: "certalis", actor: admin, body: { opportunityId: (opportunity.body.opportunity as { id: string }).id, firstName: "Ada", lastName: "Lovelace", email: "ada@acme.test" } });

    const archived = await handleArchiveOpportunityContact(deps, { customerId: "certalis", actor: admin, contactId: (contact.body.contact as { id: string }).id });

    expect(archived.body.contact).toMatchObject({ archivedAt: "2026-07-12T17:00:00.000Z" });
    const records = await deps.audit.query({ customerId: "certalis", subjectType: "opportunity_contact" });
    expect(records.at(-1)).toMatchObject({ action: "opportunity_contact.archived", outcome: "success" });
    expect(deps.diagnostics.append).toHaveBeenCalledWith(expect.objectContaining({ operation: "opportunity_contact.archived" }));
  });

  it("rejects creation beneath archived parents and records the denied operation as support evidence", async () => {
    const deps = createDeps();
    const account = await handleCreateSalesAccount(deps, { customerId: "certalis", actor: admin, body: { name: "Acme Labs", kind: "prospect" } });
    const accountId = (account.body.account as { id: string }).id;
    await handleArchiveSalesAccount(deps, { customerId: "certalis", actor: admin, accountId });

    const opportunity = await handleCreateSalesOpportunity(deps, { customerId: "certalis", actor: admin, body: { accountId, name: "Late proof", status: "open" } });

    expect(opportunity).toEqual({ status: 409, body: { error: "Archived account cannot accept new or reparented Sales records." } });
    const denied = await deps.audit.query({ customerId: "certalis", subjectType: "account" });
    expect(denied.at(-1)).toMatchObject({ action: "opportunity.created", outcome: "denied", subjectId: accountId });
    expect(deps.diagnostics.append).toHaveBeenCalledWith(expect.objectContaining({ operation: "opportunity.created", outcome: "failure", details: expect.objectContaining({ reason: "parent_archived" }) }));
  });

  it("denies a child write when its parent archives after the handler lookup but before the atomic writer commits", async () => {
    const deps = createDeps();
    const account = await handleCreateSalesAccount(deps, { customerId: "certalis", actor: admin, body: { name: "Acme Labs", kind: "prospect" } });
    const accountId = (account.body.account as { id: string }).id;
    const commit = deps.writer.commit;
    deps.writer.commit = async (input) => {
      if (input.activeParentGuard?.type === "account") {
        const parent = await deps.records.findAccount("certalis", accountId);
        if (parent) await deps.records.saveAccount({ ...parent, archivedAt: new Date("2026-07-12T17:01:00.000Z") });
      }
      return commit(input);
    };

    const opportunity = await handleCreateSalesOpportunity(deps, { customerId: "certalis", actor: admin, body: { accountId, name: "Late proof", status: "open" } });
    const records = await handleListSalesRecords(deps, { customerId: "certalis", actor: admin });
    const denied = await deps.audit.query({ customerId: "certalis", subjectType: "account" });

    expect(opportunity).toEqual({ status: 409, body: { error: "Archived account cannot accept new or reparented Sales records." } });
    expect(records.body).toMatchObject({ opportunities: [] });
    expect(denied.at(-1)).toMatchObject({ action: "opportunity.created", outcome: "denied", subjectId: accountId });
  });

  it("does not let a stale Account patch reactivate history after a concurrent archive", async () => {
    const deps = createDeps();
    const created = await handleCreateSalesAccount(deps, { customerId: "certalis", actor: admin, body: { name: "Acme Labs", kind: "prospect" } });
    const accountId = (created.body.account as { id: string }).id;
    const commit = deps.writer.commit;
    deps.writer.commit = async (input) => {
      if (input.activeRecordGuard?.type === "account") {
        const record = await deps.records.findAccount("certalis", accountId);
        if (record) await deps.records.saveAccount({ ...record, archivedAt: new Date("2026-07-12T17:01:00.000Z") });
      }
      return commit(input);
    };

    const response = await handleUpdateSalesAccount(deps, { customerId: "certalis", actor: admin, accountId, body: { name: "Renamed Acme", kind: "prospect" } });
    const account = await deps.records.findAccount("certalis", accountId);
    const denied = await deps.audit.query({ customerId: "certalis", subjectType: "account" });

    expect(response).toEqual({ status: 409, body: { error: "Archived account cannot be updated." } });
    expect(account).toMatchObject({ name: "Acme Labs", archivedAt: new Date("2026-07-12T17:01:00.000Z") });
    expect(denied.at(-1)).toMatchObject({ action: "account.updated", outcome: "denied", subjectId: accountId, details: expect.objectContaining({ reason: "record_archived" }) });
  });

  it("does not let stale Opportunity or Contact patches reactivate history after a concurrent archive", async () => {
    const deps = createDeps();
    const account = await handleCreateSalesAccount(deps, { customerId: "certalis", actor: admin, body: { name: "Acme Labs", kind: "prospect" } });
    const accountId = (account.body.account as { id: string }).id;
    const opportunity = await handleCreateSalesOpportunity(deps, { customerId: "certalis", actor: admin, body: { accountId, name: "Proof", status: "open" } });
    const opportunityId = (opportunity.body.opportunity as { id: string }).id;
    const commit = deps.writer.commit;
    deps.writer.commit = async (input) => {
      if (input.activeRecordGuard?.type === "opportunity") {
        const record = await deps.records.findOpportunity("certalis", input.activeRecordGuard.id);
        if (record) await deps.records.saveOpportunity({ ...record, archivedAt: new Date("2026-07-12T17:01:00.000Z") });
      }
      if (input.activeRecordGuard?.type === "opportunity_contact") {
        const record = await deps.records.findContact("certalis", input.activeRecordGuard.id);
        if (record) await deps.records.saveContact({ ...record, archivedAt: new Date("2026-07-12T17:01:00.000Z") });
      }
      return commit(input);
    };

    const opportunityResponse = await handleUpdateSalesOpportunity(deps, { customerId: "certalis", actor: admin, opportunityId, body: { accountId, name: "Renamed proof", status: "won" } });
    const replacement = await handleCreateSalesOpportunity(deps, { customerId: "certalis", actor: admin, body: { accountId, name: "Replacement proof", status: "open" } });
    const replacementId = (replacement.body.opportunity as { id: string }).id;
    const contact = await handleCreateOpportunityContact(deps, { customerId: "certalis", actor: admin, body: { opportunityId: replacementId, firstName: "Ada", lastName: "Lovelace", email: "ada@acme.test" } });
    const contactId = (contact.body.contact as { id: string }).id;
    const contactResponse = await handleUpdateOpportunityContact(deps, { customerId: "certalis", actor: admin, contactId, body: { opportunityId: replacementId, firstName: "Ada", lastName: "Byron", email: "ada@acme.test" } });

    expect(opportunityResponse).toEqual({ status: 409, body: { error: "Archived opportunity cannot be updated." } });
    expect(await deps.records.findOpportunity("certalis", opportunityId)).toMatchObject({ name: "Proof", archivedAt: new Date("2026-07-12T17:01:00.000Z") });
    expect(contactResponse).toEqual({ status: 409, body: { error: "Archived opportunity contact cannot be updated." } });
    expect(await deps.records.findContact("certalis", contactId)).toMatchObject({ lastName: "Lovelace", archivedAt: new Date("2026-07-12T17:01:00.000Z") });
  });

  it("does not reparent an active Opportunity or Contact into archived history", async () => {
    const deps = createDeps();
    const activeAccount = await handleCreateSalesAccount(deps, { customerId: "certalis", actor: admin, body: { name: "Active", kind: "prospect" } });
    const archivedAccount = await handleCreateSalesAccount(deps, { customerId: "certalis", actor: admin, body: { name: "Archived", kind: "prospect" } });
    const activeAccountId = (activeAccount.body.account as { id: string }).id;
    const archivedAccountId = (archivedAccount.body.account as { id: string }).id;
    await handleArchiveSalesAccount(deps, { customerId: "certalis", actor: admin, accountId: archivedAccountId });
    const opportunity = await handleCreateSalesOpportunity(deps, { customerId: "certalis", actor: admin, body: { accountId: activeAccountId, name: "Proof", status: "open" } });
    const opportunityId = (opportunity.body.opportunity as { id: string }).id;
    const moved = await handleUpdateSalesOpportunity(deps, { customerId: "certalis", actor: admin, opportunityId, body: { accountId: archivedAccountId, name: "Proof", status: "open" } });
    const contact = await handleCreateOpportunityContact(deps, { customerId: "certalis", actor: admin, body: { opportunityId, firstName: "Ada", lastName: "Lovelace", email: "ada@acme.test" } });
    const contactId = (contact.body.contact as { id: string }).id;
    await handleArchiveSalesOpportunity(deps, { customerId: "certalis", actor: admin, opportunityId });
    const movedContact = await handleUpdateOpportunityContact(deps, { customerId: "certalis", actor: admin, contactId, body: { opportunityId, firstName: "Ada", lastName: "Lovelace", email: "ada@acme.test" } });

    expect(moved).toEqual({ status: 409, body: { error: "Archived account cannot accept new or reparented Sales records." } });
    expect(movedContact).toEqual({ status: 409, body: { error: "Archived opportunity cannot accept new or reparented Sales records." } });
  });

  it("does not expose Certalis records to a Helios Customer or allow cross-Customer parent references", async () => {
    const deps = createDeps();
    const account = await handleCreateSalesAccount(deps, { customerId: "certalis", actor: admin, body: { name: "Acme Labs", kind: "prospect" } });
    const accountId = (account.body.account as { id: string }).id;
    const helios = { ...admin, email: "admin@helioscx.demo" };
    const crossCustomerOpportunity = await handleCreateSalesOpportunity(deps, { customerId: "helios", actor: helios, body: { accountId, name: "Leak", status: "open" } });
    const heliosRecords = await handleListSalesRecords(deps, { customerId: "helios", actor: helios, search: "Acme" });

    expect(crossCustomerOpportunity).toEqual({ status: 404, body: { error: "account not found" } });
    expect(heliosRecords.body).toMatchObject({ accounts: [], opportunities: [], contacts: [] });
  });

  it("writes audit and diagnostic-supportable evidence for every successful mutation", async () => {
    const deps = createDeps();
    await handleCreateSalesAccount(deps, { customerId: "certalis", actor: admin, body: { name: "Acme Labs", kind: "current_customer" } });

    const records = await deps.audit.query({ customerId: "certalis", subjectType: "account" });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ action: "account.created", actorEmail: "sales-admin@certalis.demo", outcome: "success" });
    expect(deps.diagnostics.append).toHaveBeenCalledWith(expect.objectContaining({ operation: "account.created", customerId: "certalis", details: expect.objectContaining({ integrationSurface: "local_sales_records" }) }));
  });

  it("returns a supportable failure without persisting a partial record when the atomic writer rejects", async () => {
    const deps = createDeps();
    deps.writer.commit = vi.fn().mockRejectedValue(new Error("diagnostic store unavailable"));

    const response = await handleCreateSalesAccount(deps, { customerId: "certalis", actor: admin, body: { name: "Acme Labs", kind: "prospect" } });
    const records = await handleListSalesRecords(deps, { customerId: "certalis", actor: admin });

    expect(response.status).toBe(503);
    expect(records.body).toMatchObject({ accounts: [] });
  });

  it("returns a supportable failure instead of an unhandled 500 when durable persistence fails", async () => {
    const deps = createDeps();
    deps.writer.commit = vi.fn().mockRejectedValue(new Error("database unavailable"));

    const response = await handleCreateSalesAccount(deps, { customerId: "certalis", actor: admin, body: { name: "Acme Labs", kind: "prospect" } });

    expect(response.status).toBe(503);
    expect(deps.logger.error).toHaveBeenCalledWith("sales record transaction failed", expect.objectContaining({ action: "account.created", errorType: "Error" }));
  });
});
