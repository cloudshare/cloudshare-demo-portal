import { afterAll, afterEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPrismaLabLaunchRepository } from "./prisma-lab-launch-repository";

const prisma = new PrismaClient();
const createdCustomerIds = new Set<string>();

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(async () => {
  const customerIds = [...createdCustomerIds];
  createdCustomerIds.clear();

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

describe("createPrismaLabLaunchRepository", () => {
  it("correlates a pending launch by CloudShare webhook owner even when the environment name is the blueprint name", async () => {
    const suffix = Date.now();
    const customer = await prisma.customer.create({
      data: {
        id: `customer-lab-launch-${suffix}`,
        slug: `lab-launch-${suffix}`,
        name: "Helios CX",
      },
    });
    createdCustomerIds.add(customer.id);

    const exam = await prisma.exam.create({
      data: {
        id: `exam-lab-launch-${suffix}`,
        customerId: customer.id,
        title: "Helios Network Security Exam",
        description: "",
        timeLimitMinutes: 120,
        openPeriodMinutes: 180,
        scoreRetrievalEnabled: false,
        status: "published",
        publishedAt: new Date("2026-06-24T12:00:00.000Z"),
        createdAt: new Date("2026-06-24T12:00:00.000Z"),
        updatedAt: new Date("2026-06-24T12:00:00.000Z"),
        projectId: "project-1",
        projectName: "Helios CX Project",
        blueprintId: "bp-1",
        blueprintName: "Linux Environment with xRDP v2",
        snapshotId: "snapshot-1",
        snapshotName: "Default",
        allowedRegionsJson: JSON.stringify([{ id: "region-1", name: "US East" }]),
        policyId: "policy-1",
        policyName: "10 mins run time - 2 days storage - Always on",
        instructorId: "instructor-1",
        instructorName: "Instructor",
      },
    });

    const candidate = await prisma.user.create({
      data: {
        id: `candidate-lab-launch-${suffix}`,
        customerId: customer.id,
        email: "candidate4@myplace.demo",
        firstName: "Candidate",
        lastName: "Four",
        passwordHash: "hash",
        role: "candidate",
      },
    });

    const attempt = await prisma.examAttempt.create({
      data: {
        id: `attempt-lab-launch-${suffix}`,
        customerId: customer.id,
        candidateId: candidate.id,
        examId: exam.id,
        status: "ready",
        scheduledFor: new Date("2026-06-24T19:00:00.000Z"),
        createdAt: new Date("2026-06-24T18:55:00.000Z"),
      },
    });

    await prisma.labLaunch.create({
      data: {
        id: `launch-lab-launch-${suffix}`,
        examAttemptId: attempt.id,
        candidateId: candidate.id,
        participantEmail: "candidate4@myplace.demo",
        trainingId: "EX3s7GRuHHng7ozvYmj3GmIA2",
        experienceId: "EX3s7GRuHHng7ozvYmj3GmIA2",
        loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/token",
        status: "launched",
        createdAt: new Date("2026-06-24T18:56:00.000Z"),
      },
    });

    const repository = createPrismaLabLaunchRepository(prisma);

    await expect(
      repository.findPendingEnvironmentCorrelation?.({
        customerId: customer.id,
        participantEmail: "candidate4@myplace.demo",
        environmentName: "Linux Environment with xRDP v2",
      }),
    ).resolves.toMatchObject({
      examAttemptId: attempt.id,
      participantEmail: "candidate4@myplace.demo",
      environmentExternalId: undefined,
    });
  });
});
