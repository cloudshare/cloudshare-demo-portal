import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createPrismaAdminExamAttemptDiagnosticContextRepository } from "./prisma-admin-exam-attempt-diagnostic-context-repository";

function makePrisma(overrides?: {
  readonly examAttemptFindFirst?: ReturnType<typeof vi.fn>;
  readonly userFindFirst?: ReturnType<typeof vi.fn>;
}): PrismaClient {
  return {
    examAttempt: {
      findFirst: overrides?.examAttemptFindFirst ?? vi.fn(),
    },
    user: {
      findFirst: overrides?.userFindFirst ?? vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("createPrismaAdminExamAttemptDiagnosticContextRepository", () => {
  it("rejects a read model when the related Exam belongs to another customer", async () => {
    const prisma = makePrisma({
      examAttemptFindFirst: vi.fn().mockResolvedValue({
        id: "attempt-1",
        customerId: "customer-a",
        status: "scheduled",
        scheduledFor: new Date("2026-06-21T09:00:00.000Z"),
        createdAt: new Date("2026-06-20T09:00:00.000Z"),
        candidateId: "candidate-1",
        examId: "exam-1",
        exam: {
          id: "exam-1",
          customerId: "customer-b",
          title: "Cross-tenant exam",
          status: "published",
          scoreRetrievalEnabled: true,
        },
        labLaunch: null,
      }),
      userFindFirst: vi.fn(),
    });

    const repository = createPrismaAdminExamAttemptDiagnosticContextRepository(prisma);

    await expect(repository.findByExamAttemptId("customer-a", "attempt-1")).resolves.toBeNull();
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("looks up the candidate within the same customer boundary", async () => {
    const prisma = makePrisma({
      examAttemptFindFirst: vi.fn().mockResolvedValue({
        id: "attempt-1",
        customerId: "customer-a",
        status: "scheduled",
        scheduledFor: new Date("2026-06-21T09:00:00.000Z"),
        createdAt: new Date("2026-06-20T09:00:00.000Z"),
        candidateId: "candidate-1",
        examId: "exam-1",
        exam: {
          id: "exam-1",
          customerId: "customer-a",
          title: "Helios CX Analyst",
          status: "published",
          scoreRetrievalEnabled: true,
        },
        labLaunch: null,
      }),
      userFindFirst: vi.fn().mockResolvedValue({
        id: "candidate-1",
        email: "candidate@helioscx.demo",
        firstName: "Casey",
        lastName: "Rivera",
      }),
    });

    const repository = createPrismaAdminExamAttemptDiagnosticContextRepository(prisma);

    await repository.findByExamAttemptId("customer-a", "attempt-1");

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        id: "candidate-1",
        customerId: "customer-a",
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
      },
    });
  });
});
