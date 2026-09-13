import { describe, expect, it, vi } from "vitest";
import { createPrismaSalesParticipantLaunchLinkRepository } from "./prisma-sales-participant-launch-link-repository";

describe("Prisma Sales Participant launch-link repository", () => {
  it("records a controlled failure without mutating an active capability", async () => {
    const createOperation = vi.fn().mockResolvedValue({});
    const updateLinks = vi.fn();
    const createLink = vi.fn();
    const prisma = {
      salesParticipantLaunchOperation: { create: createOperation },
      salesParticipantLaunchLink: {
        updateMany: updateLinks,
        create: createLink,
      },
    };
    const repository = createPrismaSalesParticipantLaunchLinkRepository(
      prisma as never,
    );

    await repository.recordFailure({
      customerId: "customer-a",
      salesDemoSessionId: "session-a",
      participantId: "participant-a",
      correlationId: "correlation-a",
      operation: "generate",
      safeReason: "persistence_failure",
      occurredAt: new Date("2026-09-13T00:00:00.000Z"),
    });

    expect(updateLinks).not.toHaveBeenCalled();
    expect(createLink).not.toHaveBeenCalled();
    expect(createOperation).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerId: "customer-a",
        salesDemoSessionId: "session-a",
        salesSessionParticipantId: "participant-a",
        correlationId: "correlation-a",
        operation: "generate",
        outcome: "failure",
        safeReason: "persistence_failure",
      }),
    });
  });
});
