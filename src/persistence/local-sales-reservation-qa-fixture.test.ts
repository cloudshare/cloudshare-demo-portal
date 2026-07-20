import { describe, expect, it, vi } from "vitest";
import type { SalesDemoSession, SalesDemoSessionRepository } from "@/domain/sales-demo-session";
import { handleCreateSalesDemoSession } from "@/api/sales-demo-sessions";
import { createInMemorySalesRecordRepository } from "@/domain/sales-records";
import { withLocalSalesReservationFailureQaFixture } from "./local-sales-reservation-qa-fixture";

const reservation = (customerId = "certalis", opportunityId = "opp-qa"): SalesDemoSession => ({ id: `${customerId}-session`, customerId, opportunityId, itemId: "item-1", cloudShareSalesExperienceId: `pending:${customerId}-session`, externalId: `${customerId}session`, type: "demo", start: "2026-07-20T09:00", end: "2026-07-20T10:00", timeZone: "UTC", salesProEmail: "admin@certalis.demo", salesProDisplayName: "Pending", registrationType: "registeredParticipantsOnly", sendInvitations: "salesProsAndParticipants", revision: 1, operationalStatus: "provisioning", createdAt: new Date() });
const enabled = { NODE_ENV: "development", PORTAL_LOCAL_QA_SCENARIO: "sales-reservation-persistence-failure", PORTAL_LOCAL_QA_SALES_CUSTOMER_ID: "certalis", PORTAL_LOCAL_QA_SALES_OPPORTUNITY_ID: "opp-qa" } satisfies NodeJS.ProcessEnv;

describe("local Sales reservation persistence QA fixture", () => {
  it("is impossible to enable in production", async () => {
    const save = vi.fn();
    const repo = withLocalSalesReservationFailureQaFixture({ save, listByOpportunity: vi.fn() }, { ...enabled, NODE_ENV: "production" }, new Set());
    await repo.save(reservation());
    expect(save).toHaveBeenCalledOnce();
  });

  it("stays disabled unless both exact target identifiers are configured", async () => {
    const save = vi.fn();
    const repo = withLocalSalesReservationFailureQaFixture({ save, listByOpportunity: vi.fn() }, { NODE_ENV: "development", PORTAL_LOCAL_QA_SCENARIO: "sales-reservation-persistence-failure", PORTAL_LOCAL_QA_SALES_CUSTOMER_ID: "certalis" }, new Set());
    await repo.save(reservation());
    expect(save).toHaveBeenCalledOnce();
  });

  it("rejects exactly one matching pre-provision reservation and never affects another Customer or Opportunity", async () => {
    const save = vi.fn(); const fired = new Set<string>();
    const repo = withLocalSalesReservationFailureQaFixture({ save, listByOpportunity: vi.fn() }, enabled, fired);
    await repo.save(reservation("helios", "opp-qa"));
    await repo.save(reservation("certalis", "opp-other"));
    await expect(repo.save(reservation())).rejects.toThrow("Local QA fixture");
    await repo.save(reservation());
    expect(save).toHaveBeenCalledTimes(3);
  });

  it("uses the normal handler response, diagnostic, and audit path; retry succeeds without a first-attempt CloudShare call", async () => {
    const records = createInMemorySalesRecordRepository(); await records.saveOpportunity({ id: "opp-qa", customerId: "certalis", accountId: "account-1", name: "QA Opportunity", status: "open", archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const stored: SalesDemoSession[] = [];
    const base: SalesDemoSessionRepository = { save: vi.fn(async (value) => { stored.push(value); }), listByOpportunity: vi.fn(async () => stored), updateOperationalState: vi.fn() };
    const sessions = withLocalSalesReservationFailureQaFixture(base, enabled, new Set());
    const delivery = { createSession: vi.fn().mockResolvedValue({ salesExperienceId: "sales-qa", request: {}, response: {} }) }; const deliveryFactory = { forConnection: vi.fn().mockReturnValue(delivery) }; const members = { listActiveProjectMembers: vi.fn().mockResolvedValue({ members: [{ email: "admin@certalis.demo", displayName: "Sales Admin" }], request: {}, response: {}, integrationSurface: "cloudshare.v3.project_members_gui" }) }; const validator = { revalidate: vi.fn().mockResolvedValue([]) }; const diagnostics = { record: vi.fn() }; const audit = { write: vi.fn() };
    const deps = { records, items: { findById: vi.fn().mockResolvedValue({ id: "item-1", customerId: "certalis", name: "Demo", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" }) }, sessions, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, deliveryFactory, itemProvisioningValidator: validator, projectMembers: members, diagnostics, audit, timezones: { find: vi.fn().mockResolvedValue({ customerId: "certalis", timezones: [{ id: "UTC", name: "UTC" }], fetchedAt: new Date() }) }, newId: vi.fn().mockReturnValueOnce("failed-qa").mockReturnValueOnce("retry-qa") };
    const request = { customerId: "certalis", actor: { type: "admin", id: "admin", email: "admin@certalis.demo" }, body: { opportunityId: "opp-qa", itemId: "item-1", salesProEmail: "admin@certalis.demo", start: "2026-07-20T09:00", end: "2026-07-20T10:00", timeZone: "UTC" } };
    const failed = await handleCreateSalesDemoSession(deps, request);
    expect(failed).toMatchObject({ status: 503, body: { correlationId: expect.any(String), needsAttention: false, creationOutcome: { dimension: "certalis_creation", value: "not_created", source: "certalis_pre_dispatch", retry: "safe" } } }); expect(deliveryFactory.forConnection).not.toHaveBeenCalled(); expect(validator.revalidate).not.toHaveBeenCalled(); expect(members.listActiveProjectMembers).not.toHaveBeenCalled(); expect(delivery.createSession).not.toHaveBeenCalled(); expect(stored).toEqual([]);
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ failureMode: "local_reservation_persistence", cloudShareAttempted: false }) })); expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure" }));
    expect((await handleCreateSalesDemoSession(deps, request)).status).toBe(201); expect(delivery.createSession).toHaveBeenCalledOnce();
  });
});
