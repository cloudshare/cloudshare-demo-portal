import { describe, expect, it, vi } from "vitest";
import { handleListSalesSessionOperations } from "./sales-session-operations";

describe("Sales Session operations API handler", () => {
  it("returns customer-scoped persisted sessions without requiring a selected Opportunity", async () => {
    const result = await handleListSalesSessionOperations({ sessions: { list: async (customerId) => [{ id: "session-1", customerId, opportunityId: "opp-1", itemId: "item-1", cloudShareSalesExperienceId: "server-only", externalId: "opaque", type: "demo", start: "2026-07-15T08:00", end: "2026-07-15T10:00", timeZone: "UTC", salesProEmail: "admin@certalis.demo", salesProDisplayName: "Sales Admin", registrationType: "registeredParticipantsOnly", sendInvitations: "dontSend", createdAt: new Date("2026-07-15T00:00:00Z") }] }, now: () => new Date("2026-07-15T09:00:00Z") }, { customerId: "certalis", actor: { type: "admin", id: "admin", email: "admin@certalis.demo" } });

    expect(result).toMatchObject({ status: 200, body: { sessions: [{ id: "session-1", operation: { dimension: "certalis_operation", value: "correlated" }, experience: { dimension: "cloudshare_sales_experience", value: "inProgress" } }] } });
    expect(JSON.stringify(result.body)).not.toContain("lifecycle");
    expect(JSON.stringify(result.body)).not.toContain("server-only");
  });

  it("uses the Account-scoped Session query instead of loading every Customer Session", async () => {
    const session = { id: "session-1", customerId: "certalis", opportunityId: "opp-1", itemId: "item-1", cloudShareSalesExperienceId: "server-only", externalId: "opaque", type: "demo" as const, start: "2026-07-15T08:00", end: "2026-07-15T10:00", timeZone: "UTC", salesProEmail: "admin@certalis.demo", salesProDisplayName: "Sales Admin", registrationType: "registeredParticipantsOnly" as const, sendInvitations: "dontSend" as const, createdAt: new Date("2026-07-15T00:00:00Z") };
    const list = vi.fn(); const listByAccount = vi.fn().mockResolvedValue([session]); const findOpportunity = vi.fn();
    const result = await handleListSalesSessionOperations({ sessions: { list, listByAccount }, records: { findOpportunity }, now: () => new Date("2026-07-15T09:00:00Z") }, { customerId: "certalis", accountId: "account-1", actor: { type: "admin", id: "admin", email: "admin@certalis.demo" } });

    expect(result).toMatchObject({ status: 200, body: { sessions: [{ id: "session-1" }] } });
    expect(listByAccount).toHaveBeenCalledWith("certalis", "account-1");
    expect(list).not.toHaveBeenCalled();
    expect(findOpportunity).not.toHaveBeenCalled();
  });

  it("accepts separate provider and portal status filters without flattening them", async () => {
    const session = { id: "session-1", customerId: "certalis", opportunityId: "opp-1", itemId: "item-1", cloudShareSalesExperienceId: "server-only", externalId: "opaque", type: "demo" as const, start: "2026-07-16T08:00", end: "2026-07-16T10:00", timeZone: "UTC", salesProEmail: "admin@certalis.demo", salesProDisplayName: "Sales Admin", registrationType: "registeredParticipantsOnly" as const, sendInvitations: "dontSend" as const, operationalStatus: "needs_attention" as const, createdAt: new Date("2026-07-15T00:00:00Z") };
    const deps = { sessions: { list: vi.fn().mockResolvedValue([session]), listByAccount: vi.fn() }, now: () => new Date("2026-07-15T09:00:00Z") };

    await expect(handleListSalesSessionOperations(deps, { customerId: "certalis", operationStatus: "needs_attention", actor: { type: "admin", id: "admin", email: "admin@certalis.demo" } })).resolves.toMatchObject({ body: { sessions: [{ operation: { dimension: "certalis_operation", value: "needs_attention" }, experience: { dimension: "cloudshare_sales_experience", value: "notStarted" } }] } });
    await expect(handleListSalesSessionOperations(deps, { customerId: "certalis", experienceStatus: "notStarted", actor: { type: "admin", id: "admin", email: "admin@certalis.demo" } })).resolves.toMatchObject({ body: { sessions: [{ operation: { value: "needs_attention" }, experience: { value: "notStarted" } }] } });
  });

  it("does not accept the retired combined lifecycle filter", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const result = await handleListSalesSessionOperations({ sessions: { list } }, { customerId: "certalis", actor: { type: "admin", id: "admin", email: "admin@certalis.demo" }, lifecycle: "needs_attention" } as never);

    expect(result).toEqual({ status: 400, body: { error: "Use the separate Certalis operation or CloudShare Experience status filter." } });
    expect(list).not.toHaveBeenCalled();
  });
});
