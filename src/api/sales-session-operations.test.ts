import { describe, expect, it } from "vitest";
import { handleListSalesSessionOperations } from "./sales-session-operations";

describe("Sales Session operations API handler", () => {
  it("returns customer-scoped persisted sessions without requiring a selected Opportunity", async () => {
    const result = await handleListSalesSessionOperations({ sessions: { list: async (customerId) => [{ id: "session-1", customerId, opportunityId: "opp-1", itemId: "item-1", cloudShareSalesExperienceId: "server-only", externalId: "opaque", type: "demo", start: "2026-07-15T08:00", end: "2026-07-15T10:00", timeZone: "UTC", salesProEmail: "admin@certalis.demo", salesProDisplayName: "Sales Admin", registrationType: "registeredParticipantsOnly", sendInvitations: "dontSend", createdAt: new Date("2026-07-15T00:00:00Z") }] }, now: () => new Date("2026-07-15T09:00:00Z") }, { customerId: "certalis", actor: { type: "admin", id: "admin", email: "admin@certalis.demo" } });

    expect(result).toMatchObject({ status: 200, body: { sessions: [{ id: "session-1", lifecycle: "in_progress" }] } });
    expect(JSON.stringify(result.body)).not.toContain("server-only");
  });
});
