import { afterAll, afterEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPrismaExamClockRepository } from "./prisma-exam-clock-repository";
import { createExamClock } from "@/domain/exam-clock";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(async () => {
  await prisma.examClock.deleteMany();
  await prisma.examAttempt.deleteMany({
    where: {
      id: {
        startsWith: "clock-attempt-",
      },
    },
  });
  await prisma.exam.deleteMany({
    where: {
      id: {
        startsWith: "clock-exam-",
      },
    },
  });
  await prisma.customer.deleteMany({
    where: {
      slug: {
        startsWith: "clock-customer-",
      },
    },
  });
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
    await prisma.exam.create({
      data: {
        id: `clock-exam-${suffix}`,
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
    await prisma.examAttempt.create({
      data: {
        id: `clock-attempt-${suffix}`,
        customerId: customer.id,
        candidateId: "candidate-1",
        examId: `clock-exam-${suffix}`,
        status: "ready",
        scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
        createdAt: new Date("2026-06-15T10:00:00.000Z"),
      },
    });

    const repository = createPrismaExamClockRepository(prisma);
    let nowMs = 0;

    const createService = () =>
      createExamClock({
        clocks: repository,
        now: () => new Date(nowMs),
      });

    const first = createService();
    await first.resumeTimer(`clock-attempt-${suffix}`);
    nowMs = 2_000;
    await first.pauseTimer(`clock-attempt-${suffix}`);

    const restarted = createService();
    nowMs = 8_000;
    await restarted.resumeTimer(`clock-attempt-${suffix}`);
    nowMs = 9_250;
    await restarted.pauseTimer(`clock-attempt-${suffix}`);

    await expect(restarted.getTimerState(`clock-attempt-${suffix}`)).resolves.toMatchObject({
      examAttemptId: `clock-attempt-${suffix}`,
      status: "paused",
      elapsedAtPauseMs: 3_250,
    });
  });
});
