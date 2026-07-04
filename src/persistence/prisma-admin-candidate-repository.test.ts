import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createPrismaAdminCandidateRepository } from "./prisma-admin-candidate-repository";

function makePrisma(overrides?: {
  readonly userFindMany?: ReturnType<typeof vi.fn>;
  readonly userFindFirst?: ReturnType<typeof vi.fn>;
  readonly examAttemptFindMany?: ReturnType<typeof vi.fn>;
}): PrismaClient {
  return {
    user: {
      findMany: overrides?.userFindMany ?? vi.fn(),
      findFirst: overrides?.userFindFirst ?? vi.fn(),
    },
    examAttempt: {
      findMany: overrides?.examAttemptFindMany ?? vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("createPrismaAdminCandidateRepository", () => {
  it("lists only candidate users for the authenticated Customer and maps their attempts", async () => {
    const prisma = makePrisma({
      userFindMany: vi.fn().mockResolvedValue([
        {
          id: "candidate-1",
          customerId: "customer-1",
          email: "casey@helioscx.demo",
          firstName: "Casey",
          lastName: "Rivera",
          role: "candidate",
          createdAt: new Date("2026-06-18T09:00:00.000Z"),
        },
      ]),
      examAttemptFindMany: vi.fn().mockResolvedValue([
        {
          id: "attempt-1",
          customerId: "customer-1",
          candidateId: "candidate-1",
          examId: "exam-1",
          status: "completed",
          scheduledFor: new Date("2026-06-19T10:00:00.000Z"),
          createdAt: new Date("2026-06-18T10:00:00.000Z"),
          updatedAt: new Date("2026-06-19T11:00:00.000Z"),
          exam: {
            title: "Helios Cloud Admin",
            scoreRetrievalEnabled: true,
          },
        },
      ]),
    });

    const repository = createPrismaAdminCandidateRepository(prisma);

    await expect(
      repository.listByCustomerId("customer-1", { search: "casey" }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "candidate-1",
        customerId: "customer-1",
        email: "casey@helioscx.demo",
        attempts: [
          expect.objectContaining({
            id: "attempt-1",
            examTitle: "Helios Cloud Admin",
            scoreRetrievalEnabled: true,
          }),
        ],
      }),
    ]);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        customerId: "customer-1",
        role: "candidate",
        OR: [
          { email: { contains: "casey" } },
          { firstName: { contains: "casey" } },
          { lastName: { contains: "casey" } },
        ],
      },
      select: {
        id: true,
        customerId: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true,
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { email: "asc" }],
    });
    expect(prisma.examAttempt.findMany).toHaveBeenCalledWith({
      where: {
        customerId: "customer-1",
        candidateId: { in: ["candidate-1"] },
      },
      include: { exam: true },
      orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });
  });

  it("returns null when a candidate detail lookup is outside the Customer scope", async () => {
    const prisma = makePrisma({
      userFindFirst: vi.fn().mockResolvedValue(null),
    });

    const repository = createPrismaAdminCandidateRepository(prisma);

    await expect(
      repository.findByCustomerIdAndCandidateId("customer-1", "candidate-2"),
    ).resolves.toBeNull();
    expect(prisma.examAttempt.findMany).not.toHaveBeenCalled();
  });
});
