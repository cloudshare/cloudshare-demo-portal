import { describe, expect, it, vi } from "vitest";
import { createInMemoryAuditRepository } from "@/persistence/audit-repository";
import { createInMemorySalesRecordRepository } from "@/domain/sales-records";
import {
  handleArchiveSalesOpportunity,
  handleCreateOpportunityContact,
  handleCreateSalesAccount,
  handleCreateSalesOpportunity,
  handleListSalesRecords,
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
      if (input.record.type === "account") await records.saveAccount(input.record.value);
      if (input.record.type === "opportunity") await records.saveOpportunity(input.record.value);
      if (input.record.type === "opportunity_contact") await records.saveContact(input.record.value);
      await audit.write(input.audit);
      await diagnostics.append(input.diagnostic);
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
