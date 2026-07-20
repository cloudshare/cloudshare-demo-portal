import { describe, expect, it, vi } from "vitest";
import { createPrismaSalesSessionParticipantRepository } from "./prisma-sales-session-participant-repository";

describe("Prisma Sales session participant repository", () => {
  it("records an environment observation only for the authenticated Customer's participant", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repository = createPrismaSalesSessionParticipantRepository({ salesSessionParticipant: { updateMany } } as never);

    await repository.recordEnvironmentObservation("customer-a", "participant-1", { statusCode: 2, observedAt: new Date("2026-07-19T09:00:00Z") });

    expect(updateMany).toHaveBeenCalledWith({
      where: { customerId: "customer-a", id: "participant-1" },
      data: { environmentStatusCode: 2, environmentObservedAt: new Date("2026-07-19T09:00:00Z"), environmentAttentionReason: null, environmentAttentionSource: null },
    });
  });
  it("fails closed when an environment observation no longer has a Customer-scoped participant", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const repository = createPrismaSalesSessionParticipantRepository({ salesSessionParticipant: { updateMany } } as never);
    await expect(repository.recordEnvironmentObservation("customer-a", "participant-1", { statusCode: 2, observedAt: new Date("2026-07-19T09:00:00Z") })).rejects.toThrow("Sales Session Participant was not found for this Customer");
  });
  it("persists an explicit Environment needs-attention reason and source", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repository = createPrismaSalesSessionParticipantRepository({ salesSessionParticipant: { updateMany } } as never);
    await repository.recordEnvironmentObservation("customer-a", "participant-1", { statusCode: null, observedAt: null, attentionReason: "environment_ambiguous_for_project", attentionSource: "cloudshare_v3_owner_email_item_project" });
    expect(updateMany).toHaveBeenCalledWith({ where: { customerId: "customer-a", id: "participant-1" }, data: { environmentStatusCode: null, environmentObservedAt: null, environmentAttentionReason: "environment_ambiguous_for_project", environmentAttentionSource: "cloudshare_v3_owner_email_item_project" } });
  });
});
