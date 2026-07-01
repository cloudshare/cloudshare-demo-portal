import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createPrismaAdminMonitoringAttemptRepository } from "./prisma-admin-monitoring-attempt-repository";

function makePrisma(overrides?: {
  readonly examAttemptGroupBy?: ReturnType<typeof vi.fn>;
  readonly examAttemptFindMany?: ReturnType<typeof vi.fn>;
  readonly examAttemptCount?: ReturnType<typeof vi.fn>;
  readonly userFindMany?: ReturnType<typeof vi.fn>;
}): PrismaClient {
  return {
    examAttempt: {
      groupBy: overrides?.examAttemptGroupBy ?? vi.fn(),
      findMany: overrides?.examAttemptFindMany ?? vi.fn(),
      count: overrides?.examAttemptCount ?? vi.fn(),
    },
    user: {
      findMany: overrides?.userFindMany ?? vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("createPrismaAdminMonitoringAttemptRepository", () => {
  it("counts summary by status instead of loading every ExamAttempt", async () => {
    const prisma = makePrisma({
      examAttemptGroupBy: vi.fn().mockResolvedValue([
        { status: "scheduled", _count: { _all: 2 } },
        { status: "completed", _count: { _all: 4 } },
      ]),
    });

    const repository = createPrismaAdminMonitoringAttemptRepository(prisma);

    await expect(repository.countSummaryByCustomerId("customer-a")).resolves.toEqual({
      scheduled: 2,
      ready: 0,
      inProgress: 0,
      suspended: 0,
      completed: 4,
      expired: 0,
    });
    expect(prisma.examAttempt.groupBy).toHaveBeenCalledWith({
      by: ["status"],
      where: { customerId: "customer-a" },
      _count: {
        _all: true,
      },
    });
    expect(prisma.examAttempt.findMany).not.toHaveBeenCalled();
  });

  it("loads only current-state attempts for the current queues", async () => {
    const prisma = makePrisma({
      examAttemptFindMany: vi.fn().mockResolvedValue([]),
      userFindMany: vi.fn().mockResolvedValue([]),
    });

    const repository = createPrismaAdminMonitoringAttemptRepository(prisma);
    await repository.listCurrentByCustomerId("customer-a");

    expect(prisma.examAttempt.findMany).toHaveBeenCalledWith({
      where: {
        customerId: "customer-a",
        status: {
          in: ["scheduled", "ready", "in_progress", "suspended"],
        },
      },
      include: {
        exam: true,
        labLaunch: true,
      },
      orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });
  });

  it("maps the authored Exam open period into monitoring attempt records", async () => {
    const prisma = makePrisma({
      examAttemptFindMany: vi.fn().mockResolvedValue([
        {
          id: "attempt-1",
          customerId: "customer-a",
          candidateId: "candidate-1",
          examId: "exam-1",
          status: "ready",
          scheduledFor: new Date("2026-07-01T09:00:00.000Z"),
          createdAt: new Date("2026-07-01T08:00:00.000Z"),
          exam: {
            title: "Windows Boxes",
            openPeriodMinutes: 20,
            scoreRetrievalEnabled: true,
          },
          labLaunch: null,
        },
      ]),
      userFindMany: vi.fn().mockResolvedValue([
        {
          id: "candidate-1",
          email: "candidate@myplace.demo",
          firstName: "Test",
          lastName: "Candidate",
        },
      ]),
    });

    const repository = createPrismaAdminMonitoringAttemptRepository(prisma);

    await expect(repository.listCurrentByCustomerId("customer-a")).resolves.toEqual([
      expect.objectContaining({
        id: "attempt-1",
        examOpenPeriodMinutes: 20,
        candidateEmail: "candidate@myplace.demo",
      }),
    ]);
  });

  it("loads only the requested terminal-history page and counts the full terminal set separately", async () => {
    const prisma = makePrisma({
      examAttemptCount: vi.fn().mockResolvedValue(42),
      examAttemptFindMany: vi.fn().mockResolvedValue([]),
      userFindMany: vi.fn().mockResolvedValue([]),
    });

    const repository = createPrismaAdminMonitoringAttemptRepository(prisma);
    await repository.listHistoryPageByCustomerId("customer-a", { limit: 25, offset: 50 });

    expect(prisma.examAttempt.count).toHaveBeenCalledWith({
      where: {
        customerId: "customer-a",
        status: {
          in: ["completed", "expired"],
        },
      },
    });
    expect(prisma.examAttempt.findMany).toHaveBeenCalledWith({
      where: {
        customerId: "customer-a",
        status: {
          in: ["completed", "expired"],
        },
      },
      include: {
        exam: true,
        labLaunch: true,
      },
      orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: 25,
      skip: 50,
    });
  });
});
