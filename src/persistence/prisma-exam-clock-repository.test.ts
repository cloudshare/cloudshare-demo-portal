import { afterAll, afterEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPrismaExamClockRepository } from "./prisma-exam-clock-repository";
import { createExamClock } from "@/domain/exam-clock";

const prisma = new PrismaClient();
const createdAttemptIds = new Set<string>();
const createdExamIds = new Set<string>();
const createdCustomerIds = new Set<string>();

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(async () => {
  const attemptIds = [...createdAttemptIds];
  const examIds = [...createdExamIds];
  const customerIds = [...createdCustomerIds];
  createdAttemptIds.clear();
  createdExamIds.clear();
  createdCustomerIds.clear();

  if (attemptIds.length > 0) {
    await prisma.examClock.deleteMany({
      where: {
        examAttemptId: {
          in: attemptIds,
        },
      },
    });
    await prisma.examAttempt.deleteMany({
      where: {
        id: {
          in: attemptIds,
        },
      },
    });
  }
  if (examIds.length > 0) {
    await prisma.exam.deleteMany({
      where: {
        id: {
          in: examIds,
        },
      },
    });
  }
  if (customerIds.length > 0) {
    await prisma.customer.deleteMany({
      where: {
        id: {
          in: customerIds,
        },
      },
    });
  }
});

describe("PrismaExamClockRepository", () => {
  it("persists elapsed time across recreated clock services", async () => {
    const suffix = Date.now().toString();
    const customer = await prisma.customer.create({
      data: {
        slug: `clock-customer-${suffix}`,
        name: "Helios CX",
      },
    });
    createdCustomerIds.add(customer.id);
    const examId = `clock-exam-${suffix}`;
    await prisma.exam.create({
      data: {
        id: examId,
        customerId: customer.id,
        title: "Clock Persistence Exam",
        description: "Exam clock persistence test",
        timeLimitMinutes: 90,
        scoreRetrievalEnabled: false,
        status: "published",
        publishedAt: new Date("2026-06-15T09:00:00.000Z"),
        createdAt: new Date("2026-06-15T09:00:00.000Z"),
        updatedAt: new Date("2026-06-15T09:00:00.000Z"),
        projectId: "project-1",
        projectName: "Helios Project",
        blueprintId: "bp-1",
        blueprintName: "Blueprint",
        snapshotId: "snap-1",
        snapshotName: "Snapshot",
        allowedRegionsJson: JSON.stringify([{ id: "region-1", name: "EU West" }]),
        policyId: "policy-1",
        policyName: "Policy",
        instructorId: "instructor-1",
        instructorName: "Instructor",
      },
    });
    createdExamIds.add(examId);
    const attemptId = `clock-attempt-${suffix}`;
    await prisma.examAttempt.create({
      data: {
        id: attemptId,
        customerId: customer.id,
        candidateId: "candidate-1",
        examId,
        status: "ready",
        scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
        createdAt: new Date("2026-06-15T10:00:00.000Z"),
      },
    });
    createdAttemptIds.add(attemptId);

    const repository = createPrismaExamClockRepository(prisma);
    let nowMs = 0;

    const createService = () =>
      createExamClock({
        clocks: repository,
        now: () => new Date(nowMs),
      });

    const first = createService();
    await first.resumeTimer(attemptId);
    nowMs = 2_000;
    await first.pauseTimer(attemptId);

    const restarted = createService();
    nowMs = 8_000;
    await restarted.resumeTimer(attemptId);
    nowMs = 9_250;
    await restarted.pauseTimer(attemptId);

    await expect(restarted.getTimerState(attemptId)).resolves.toMatchObject({
      examAttemptId: attemptId,
      status: "paused",
      elapsedAtPauseMs: 3_250,
    });
  });
});
