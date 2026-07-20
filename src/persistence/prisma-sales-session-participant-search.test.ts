import { describe, expect, it, vi } from "vitest";
import { createPrismaSalesSessionParticipantSearch } from "./prisma-sales-session-participant-search";

describe("Prisma Sales participant search", () => {
  it("applies Customer ownership, bounded pagination, and local contact matching in the repository query", async () => {
    const count = vi.fn().mockResolvedValue(1);
    const findMany = vi.fn().mockResolvedValue([{ id: "participant-1", opportunityContactId: "contact-1", cloudShareEnvironmentId: "server-only-environment", environmentStatusCode: 2, environmentObservedAt: new Date("2026-07-19T09:00:00Z"), updatedAt: new Date(), contact: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.test" }, session: { id: "session-1", sessionName: "Acme evaluation", opportunityId: "opportunity-1", operationalStatus: "active", attentionReason: null, start: "2026-07-19T08:00", end: "2026-07-19T10:00", timeZone: "UTC", experienceStatus: "inProgress", experienceStatusObservedAt: new Date("2026-07-19T09:00:00Z") } }]);
    const repository = createPrismaSalesSessionParticipantSearch({ salesSessionParticipant: { count, findMany } } as never, () => new Date("2026-07-19T09:01:00Z"));

    const result = await repository.search("customer-a", "ada", 20, 10);

    expect(count).toHaveBeenCalledWith({ where: expect.objectContaining({ customerId: "customer-a", session: { customerId: "customer-a" }, contact: expect.objectContaining({ archivedAt: null }) }) });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ customerId: "customer-a", session: { customerId: "customer-a" } }), skip: 20, take: 10 }));
    expect(result).toMatchObject({ total: 1, rows: [{ sessionId: "session-1", email: "ada@example.test", operation: { value: "correlated" }, experience: { value: "inProgress", source: "cloudshare_v4_get_sales" }, environment: { dimension: "cloudshare_environment", value: "Ready", source: "cloudshare_v3_environment" } }] });
    expect(JSON.stringify(result)).not.toContain("server-only-environment");
  });

  it("uses one clock instant for every participant row in a search page", async () => {
    const session = { id: "session-1", sessionName: "Acme evaluation", opportunityId: "opportunity-1", operationalStatus: "active", attentionReason: null, start: "2026-07-19T08:00", end: "2026-07-19T09:00", timeZone: "UTC", experienceStatus: "inProgress", experienceStatusObservedAt: new Date("2026-07-19T09:00:00Z") };
    const rows = ["participant-1", "participant-2"].map((id) => ({ id, opportunityContactId: `contact-${id}`, cloudShareEnvironmentId: null, environmentStatusCode: null, environmentObservedAt: null, updatedAt: new Date(), contact: { firstName: "Ada", lastName: id, email: `${id}@example.test` }, session }));
    const now = vi.fn().mockReturnValueOnce(new Date("2026-07-19T09:04:59Z")).mockReturnValueOnce(new Date("2026-07-19T09:05:01Z"));
    const repository = createPrismaSalesSessionParticipantSearch({ salesSessionParticipant: { count: vi.fn().mockResolvedValue(2), findMany: vi.fn().mockResolvedValue(rows) } } as never, now);

    const result = await repository.search("customer-a", "ada", 0, 20);

    expect(now).toHaveBeenCalledOnce();
    expect(result.rows.map((row) => row.experience.value)).toEqual(["inProgress", "inProgress"]);
  });

  it("projects a Deleted roster Environment with its v4 source without returning its provider reference", async () => {
    const session = { id: "session-1", sessionName: "Acme evaluation", opportunityId: "opportunity-1", operationalStatus: "active", attentionReason: null, start: "2026-07-19T08:00", end: "2026-07-19T09:00", timeZone: "UTC", experienceStatus: "inProgress", experienceStatusObservedAt: new Date("2026-07-19T09:00:00Z") };
    const row = { id: "participant-1", opportunityContactId: "contact-1", cloudShareEnvironmentId: "provider-roster-reference", cloudShareRosterEnvironmentReference: "provider-roster-reference", environmentStatus: "Deleted", environmentStatusCode: null, environmentObservedAt: new Date("2026-07-19T09:00:00Z"), updatedAt: new Date(), contact: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.test" }, session };
    const repository = createPrismaSalesSessionParticipantSearch({ salesSessionParticipant: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([row]) } } as never, () => new Date("2026-07-19T09:01:00Z"));

    const result = await repository.search("customer-a", "ada", 0, 20);

    expect(result.rows).toMatchObject([{ environment: { dimension: "cloudshare_environment", value: "Deleted", source: "cloudshare_v4_sales_participant_roster" } }]);
    expect(JSON.stringify(result)).not.toContain("provider-roster-reference");
  });
});
