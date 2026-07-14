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
    const delivery = { validateMainSalesPro: vi.fn().mockResolvedValue({ request: { method: "GET", path: "/projects/project-1/salespros" }, response: { status: 200, body: { eligible: true } } }), createSession: vi.fn().mockResolvedValue({ salesExperienceId: "sales-1", request: { method: "POST", path: "/sales", body: {} }, response: { status: 201, body: { id: "sales-1" } } }) };
    const diagnostics = { record: vi.fn().mockResolvedValue(undefined) };
    const audit = { write: vi.fn().mockResolvedValue(undefined) };

    const result = await handleCreateSalesDemoSession({ records, items, sessions, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, deliveryFactory: { forConnection: vi.fn().mockReturnValue(delivery) }, diagnostics, audit, now: () => new Date("2026-07-14T15:00:00.000Z"), newId: () => "session-1" }, { customerId: "certalis", actor: admin, body: { opportunityId: "opp-1", itemId: "item-1", start: "2026-07-15T09:00", end: "2026-07-16T09:00", timeZone: "America/Denver", type: "poc" } });

    expect(result).toMatchObject({ status: 201, body: { session: { id: "session-1", cloudShareSalesExperienceId: "sales-1", externalId: "certalis:opp:opp-1", registrationType: "registeredParticipantsOnly", sendInvitations: "dontSend" } } });
    expect(delivery.createSession).toHaveBeenCalledWith(expect.objectContaining({ opportunity: "Acme evaluation", externalId: "certalis:opp:opp-1", registrationType: "registeredParticipantsOnly", sendInvitations: "dontSend", mainSalesProEmail: admin.email, type: "poc" }));
    expect(sessions.save).toHaveBeenCalledWith(expect.objectContaining({ opportunityId: "opp-1", itemId: "item-1" }));
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: "sales.demo_session.created", correlationId: expect.any(String), outcome: "success" }));
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ operation: "sales.demo_session.created", details: expect.objectContaining({ integrationSurface: "cloudshare.v4.sales", registrationType: "registeredParticipantsOnly" }) }));
  });

  it("blocks invalid configured Sales Pro and stores supportable validation evidence without calling creation", async () => {
    const records = createInMemorySalesRecordRepository();
    await records.saveOpportunity({ id: "opp-1", customerId: "certalis", accountId: "account-1", name: "Acme evaluation", status: "open", archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const delivery = { validateMainSalesPro: vi.fn().mockRejectedValue(new Error("not a Project Sales Pro")), createSession: vi.fn() };
    const diagnostics = { record: vi.fn().mockResolvedValue(undefined) };
    const result = await handleCreateSalesDemoSession({ records, items: { findById: vi.fn().mockResolvedValue({ id: "item-1", customerId: "certalis", name: "Demo", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" }) }, sessions: { save: vi.fn(), listByOpportunity: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, deliveryFactory: { forConnection: vi.fn().mockReturnValue(delivery) }, diagnostics, audit: { write: vi.fn() }, newId: () => "session-1" }, { customerId: "certalis", actor: admin, body: { opportunityId: "opp-1", itemId: "item-1", start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "America/Denver" } });
    expect(result).toMatchObject({ status: 422, body: { correlationId: expect.any(String) } });
    expect(delivery.createSession).not.toHaveBeenCalled();
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure", details: expect.objectContaining({ failureMode: "main_sales_pro_validation" }) }));
  });
});
