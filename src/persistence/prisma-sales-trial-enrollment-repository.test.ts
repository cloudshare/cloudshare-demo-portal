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
  invitationStatus: "notSent" as const,
  participationStatus: "pending" as const,
  cloudShareRosterEnvironmentReference: null,
  environmentStatus: null,
  observedExpirationTime: null,
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
      reclaimed: false,
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: "enrollment-1", participationStatus: "pending" }),
    });
  });

  it("returns the existing reservation on the unique customer offering user conflict", async () => {
    const create = vi.fn().mockRejectedValue({
      code: "P2002",
      meta: { target: ["customerId", "salesTrialOfferingId", "portalUserId"] },
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findUnique = vi.fn().mockResolvedValue(enrollment);
    const repository = createPrismaSalesTrialEnrollmentRepository({
      salesTrialEnrollment: { create, updateMany, findUnique },
    } as never);

    await expect(repository.reserveForLaunch!(enrollment)).resolves.toEqual({
      enrollment,
      created: false,
      reclaimed: false,
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

  it("atomically reclaims a retryable failure before the next launch attempt", async () => {
    const create = vi.fn().mockRejectedValue({
      code: "P2002",
      meta: { target: ["customerId", "salesTrialOfferingId", "portalUserId"] },
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi.fn().mockResolvedValue({
      ...enrollment,
      status: "provisioning",
    });
    const repository = createPrismaSalesTrialEnrollmentRepository({
      salesTrialEnrollment: { create, updateMany, findUnique },
    } as never);

    await expect(repository.reserveForLaunch!(enrollment)).resolves.toEqual({
      enrollment: { ...enrollment, status: "provisioning" },
      created: false,
      reclaimed: true,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        customerId: "customer-1",
        salesTrialOfferingId: "offering-1",
        portalUserId: "trial-user-1",
        status: "retryable_failure",
        cloudShareParticipantId: null,
      },
      data: {
        status: "provisioning",
        attentionReason: null,
        lastReconciledAt: enrollment.lastReconciledAt,
        updatedAt: enrollment.updatedAt,
      },
    });
  });

  it("claims the extend pending fence only from an active unclaimed enrollment", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repository = createPrismaSalesTrialEnrollmentRepository({
      salesTrialEnrollment: { updateMany },
    } as never);
    const updatedAt = new Date("2026-09-01T10:15:00.000Z");

    await expect(
      repository.reserveForExtension!("customer-1", "enrollment-1", {
        updatedAt,
        attentionReason:
          "The previous Sales Trial extension outcome is still unconfirmed. Certalis must reconcile the current CloudShare state before another extension can be requested.",
      }),
    ).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        customerId: "customer-1",
        id: "enrollment-1",
        status: "active",
        attentionReason: null,
      },
      data: {
        status: "needs_attention",
        attentionReason:
          "The previous Sales Trial extension outcome is still unconfirmed. Certalis must reconcile the current CloudShare state before another extension can be requested.",
        updatedAt,
      },
    });
  });

  it("releases the extend pending fence only from the exact claimed marker", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repository = createPrismaSalesTrialEnrollmentRepository({
      salesTrialEnrollment: { updateMany },
    } as never);
    const updatedAt = new Date("2026-09-01T10:20:00.000Z");

    await expect(
      repository.releaseExtensionReservation!("customer-1", "enrollment-1", {
        updatedAt,
        expectedAttentionReason:
          "The previous Sales Trial extension outcome is still unconfirmed. Certalis must reconcile the current CloudShare state before another extension can be requested.",
      }),
    ).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        customerId: "customer-1",
        id: "enrollment-1",
        status: "needs_attention",
        attentionReason:
          "The previous Sales Trial extension outcome is still unconfirmed. Certalis must reconcile the current CloudShare state before another extension can be requested.",
      },
      data: {
        status: "active",
        attentionReason: null,
        updatedAt,
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
