import { describe, expect, it, vi } from "vitest";
import { createPrismaSalesSessionParticipantRepository } from "./prisma-sales-session-participant-repository";

describe("Prisma Sales session participant repository", () => {
  it("records an environment observation only for the authenticated Customer's participant", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repository = createPrismaSalesSessionParticipantRepository({ salesSessionParticipant: { updateMany } } as never);

    await repository.recordEnvironmentObservation("customer-a", "participant-1", { statusCode: 2, observedAt: new Date("2026-07-19T09:00:00Z") });

    expect(updateMany).toHaveBeenCalledWith({
      where: { customerId: "customer-a", id: "participant-1" },
      data: { environmentStatusCode: 2, environmentObservedAt: new Date("2026-07-19T09:00:00Z") },
    });
  });
});
