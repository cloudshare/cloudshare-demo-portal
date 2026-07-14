import { describe, expect, it, vi } from "vitest";
import { handleCreateSalesDemoSession } from "./sales-demo-sessions";
import { createInMemorySalesRecordRepository } from "@/domain/sales-records";

const admin = { type: "admin", id: "sales-admin", email: "sales-admin@certalis.demo" };

describe("Sales Demo Session API handler", () => {
  it("creates one Customer-scoped registered-only Sales Experience and records correlated evidence", async () => {
    const records = createInMemorySalesRecordRepository();
    await records.saveOpportunity({ id: "opp-1", customerId: "certalis", accountId: "account-1", name: "Acme evaluation", status: "open", archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const items = { findById: vi.fn().mockResolvedValue({ id: "item-1", customerId: "certalis", name: "Accelerate Demo", description: "", project: { id: "project-1", name: "Certalis project" }, blueprints: [{ id: "bp-1", name: "Foundation" }], policy: { id: "policy-1", name: "Sales policy" }, regions: [{ id: "region-1", name: "US West" }], salesExperienceType: "demo", defaultDurationMinutes: 1440, status: "active" }) };
    const sessions = { save: vi.fn(), listByOpportunity: vi.fn().mockResolvedValue([]) };
    const delivery = { createSession: vi.fn().mockResolvedValue({ salesExperienceId: "sales-1", request: { method: "POST", path: "/sales", body: {} }, response: { status: 201, body: { id: "sales-1" } } }) };
    const diagnostics = { record: vi.fn().mockResolvedValue(undefined) };
    const audit = { write: vi.fn().mockResolvedValue(undefined) };
    const itemProvisioningValidator = { revalidate: vi.fn().mockResolvedValue([{ request: { method: "GET", path: "/projects/project-1/blueprints" }, response: { status: 200 }, integrationSurface: "cloudshare.v3.projects.blueprints" }]) };

    const result = await handleCreateSalesDemoSession({ records, items, sessions, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, deliveryFactory: { forConnection: vi.fn().mockReturnValue(delivery) }, itemProvisioningValidator, diagnostics, audit, now: () => new Date("2026-07-14T15:00:00.000Z"), newId: () => "session-1" }, { customerId: "certalis", actor: admin, body: { opportunityId: "opp-1", itemId: "item-1", start: "2026-07-15T09:00", end: "2026-07-16T09:00", timeZone: "Mountain Standard Time", type: "poc" } });

    expect(result).toMatchObject({ status: 201, body: { session: { id: "session-1", cloudShareSalesExperienceId: "sales-1", externalId: "certalis:opp:opp-1", registrationType: "registeredParticipantsOnly", sendInvitations: "dontSend" } } });
    expect(delivery.createSession).toHaveBeenCalledWith(expect.objectContaining({ opportunity: "Acme evaluation", externalId: "certalis:opp:opp-1", registrationType: "registeredParticipantsOnly", sendInvitations: "dontSend", mainSalesProEmail: admin.email, type: "poc" }));
    expect(sessions.save).toHaveBeenCalledWith(expect.objectContaining({ opportunityId: "opp-1", itemId: "item-1" }));
    expect(itemProvisioningValidator.revalidate).toHaveBeenCalledWith(expect.objectContaining({ id: "item-1" }));
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: "sales.demo_session.created", correlationId: expect.any(String), outcome: "success" }));
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ operation: "sales.demo_session.created", details: expect.objectContaining({ integrationSurface: "cloudshare.v4.sales", registrationType: "registeredParticipantsOnly" }) }));
  });

  it("surfaces CloudShare main Sales Pro validation from the atomic create request with supportable evidence", async () => {
    const records = createInMemorySalesRecordRepository();
    await records.saveOpportunity({ id: "opp-1", customerId: "certalis", accountId: "account-1", name: "Acme evaluation", status: "open", archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const delivery = { createSession: vi.fn().mockRejectedValue(new Error("not a Project Sales Pro")) };
    const diagnostics = { record: vi.fn().mockResolvedValue(undefined) };
    const result = await handleCreateSalesDemoSession({ records, items: { findById: vi.fn().mockResolvedValue({ id: "item-1", customerId: "certalis", name: "Demo", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" }) }, sessions: { save: vi.fn(), listByOpportunity: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, deliveryFactory: { forConnection: vi.fn().mockReturnValue(delivery) }, diagnostics, audit: { write: vi.fn() }, newId: () => "session-1" }, { customerId: "certalis", actor: admin, body: { opportunityId: "opp-1", itemId: "item-1", start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "Mountain Standard Time" } });
    expect(result).toMatchObject({ status: 422, body: { correlationId: expect.any(String) } });
    expect(delivery.createSession).toHaveBeenCalledOnce();
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure", details: expect.objectContaining({ failureMode: "main_sales_pro_validation" }) }));
  });

  it("denies cross-Customer Opportunity selection with correlated audit and diagnostic evidence", async () => {
    const records = createInMemorySalesRecordRepository();
    await records.saveOpportunity({ id: "opp-other", customerId: "helios", accountId: "account-1", name: "Other", status: "open", archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const diagnostics = { record: vi.fn().mockResolvedValue(undefined) }; const audit = { write: vi.fn().mockResolvedValue(undefined) };
    const result = await handleCreateSalesDemoSession({ records, items: { findById: vi.fn() }, sessions: { save: vi.fn(), listByOpportunity: vi.fn() }, connections: { findByCustomerId: vi.fn() }, diagnostics, audit }, { customerId: "certalis", actor: admin, body: { opportunityId: "opp-other", itemId: "item-1", start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC" } });
    expect(result).toMatchObject({ status: 404, body: { correlationId: expect.any(String) } });
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ source: "sales-demo-sessions", request: { method: "POST", path: "/api/sales/demo-sessions" }, response: { status: 404 }, details: expect.objectContaining({ failureMode: "opportunity_not_found" }) }));
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ outcome: "denied", correlationId: expect.any(String) }));
  });

  it("returns needs-attention with the immutable CloudShare ID when local correlation persistence fails", async () => {
    const records = createInMemorySalesRecordRepository(); await records.saveOpportunity({ id: "opp-1", customerId: "certalis", accountId: "account-1", name: "Acme", status: "open", archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const result = await handleCreateSalesDemoSession({ records, items: { findById: vi.fn().mockResolvedValue({ id: "item-1", customerId: "certalis", name: "Demo", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" }) }, sessions: { save: vi.fn().mockRejectedValue(new Error("database unavailable")), listByOpportunity: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, deliveryFactory: { forConnection: vi.fn().mockReturnValue({ createSession: vi.fn().mockResolvedValue({ salesExperienceId: "sales-created", request: { method: "POST", path: "/sales", body: {} }, response: { status: 201, body: { id: "sales-created" } } }) }) }, diagnostics: { record: vi.fn() }, audit: { write: vi.fn() } }, { customerId: "certalis", actor: admin, body: { opportunityId: "opp-1", itemId: "item-1", start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC" } });
    expect(result).toMatchObject({ status: 503, body: { needsAttention: true, cloudShareSalesExperienceId: "sales-created", correlationId: expect.any(String) } });
  });

  it("retains the remote ID even if the secondary diagnostic and audit writes fail", async () => {
    const records = createInMemorySalesRecordRepository(); await records.saveOpportunity({ id: "opp-1", customerId: "certalis", accountId: "account-1", name: "Acme", status: "open", archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const item = { id: "item-1", customerId: "certalis", name: "Demo", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" };
    const result = await handleCreateSalesDemoSession({ records, items: { findById: vi.fn().mockResolvedValue(item) }, sessions: { save: vi.fn().mockRejectedValue(new Error("database unavailable")), listByOpportunity: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, deliveryFactory: { forConnection: vi.fn().mockReturnValue({ createSession: vi.fn().mockResolvedValue({ salesExperienceId: "sales-created", request: { method: "POST", path: "/sales", body: {} }, response: { status: 201, body: { id: "sales-created" } } }) }) }, diagnostics: { record: vi.fn().mockRejectedValue(new Error("diagnostic unavailable")) }, audit: { write: vi.fn().mockRejectedValue(new Error("audit unavailable")) } }, { customerId: "certalis", actor: admin, body: { opportunityId: "opp-1", itemId: "item-1", start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC" } });
    expect(result).toMatchObject({ status: 503, body: { needsAttention: true, cloudShareSalesExperienceId: "sales-created", correlationId: expect.any(String) } });
  });
});
