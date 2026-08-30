import { describe, expect, it, vi } from "vitest";
import { createPrismaSalesTrialEnrollmentRepository } from "./prisma-sales-trial-enrollment-repository";

const enrollment = {
  id: "enrollment-1",
  customerId: "customer-1",
  salesTrialOfferingId: "offering-1",
  portalUserId: "trial-user-1",
  email: "visitor@example.test",
  firstName: "Ari",
  lastName: "Visitor",
  cloudShareParticipantId: null,
  cloudShareRosterEnvironmentReference: null,
  environmentStatus: null,
  firstJoined: null,
  status: "provisioning" as const,
  attentionReason: null,
  lastLaunchedAt: null,
  lastReconciledAt: new Date("2026-08-30T10:00:00.000Z"),
  createdAt: new Date("2026-08-30T10:00:00.000Z"),
  updatedAt: new Date("2026-08-30T10:00:00.000Z"),
};

describe("Prisma Sales Trial enrollment repository", () => {
  it("creates a first launch reservation atomically", async () => {
    const create = vi.fn().mockResolvedValue(enrollment);
    const repository = createPrismaSalesTrialEnrollmentRepository({
      salesTrialEnrollment: { create },
    } as never);

    await expect(repository.reserveForLaunch!(enrollment)).resolves.toEqual({
      enrollment,
      created: true,
    });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: "enrollment-1" }) });
  });

  it("returns the existing reservation on the unique customer offering user conflict", async () => {
    const create = vi.fn().mockRejectedValue({
      code: "P2002",
      meta: { target: ["customerId", "salesTrialOfferingId", "portalUserId"] },
    });
    const findUnique = vi.fn().mockResolvedValue(enrollment);
    const repository = createPrismaSalesTrialEnrollmentRepository({
      salesTrialEnrollment: { create, findUnique },
    } as never);

    await expect(repository.reserveForLaunch!(enrollment)).resolves.toEqual({
      enrollment,
      created: false,
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        customerId_salesTrialOfferingId_portalUserId: {
          customerId: "customer-1",
          salesTrialOfferingId: "offering-1",
          portalUserId: "trial-user-1",
        },
      },
    });
  });

  it("preserves unrelated uniqueness violations", async () => {
    const create = vi.fn().mockRejectedValue({
      code: "P2002",
      meta: { target: ["cloudShareParticipantId"] },
    });
    const repository = createPrismaSalesTrialEnrollmentRepository({
      salesTrialEnrollment: { create },
    } as never);

    await expect(repository.reserveForLaunch!(enrollment)).rejects.toMatchObject({
      code: "P2002",
      meta: { target: ["cloudShareParticipantId"] },
    });
  });
});
