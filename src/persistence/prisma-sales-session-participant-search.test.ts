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
});
