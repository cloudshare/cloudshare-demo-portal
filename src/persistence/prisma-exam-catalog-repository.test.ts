import { afterAll, afterEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPrismaExamCatalogRepository } from "./prisma-exam-catalog-repository";

const prisma = new PrismaClient();
const createdExamIds = new Set<string>();
const createdCustomerIds = new Set<string>();

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(async () => {
  const examIds = [...createdExamIds];
  const customerIds = [...createdCustomerIds];
  createdExamIds.clear();
  createdCustomerIds.clear();

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

describe("Prisma exam catalog repository", () => {
  it("persists and reloads an exam catalog item", async () => {
    const suffix = Date.now();
    const customer = await prisma.customer.create({
      data: {
        slug: `exam-catalog-${suffix}`,
        name: "Helios CX",
      },
    });
    createdCustomerIds.add(customer.id);
    const repository = createPrismaExamCatalogRepository(prisma);
    const exam = {
      id: `exam-catalog-${suffix}`,
      customerId: customer.id,
      title: "Helios CloudShare Fundamentals",
      description: "",
      timeLimitMinutes: 240,
      storageLeaseMinutes: 2880,
      openPeriodMinutes: 720,
      scoreRetrievalEnabled: true,
      deliveryAvailability: "individual" as const,
      status: "draft" as const,
      publishedAt: null,
      createdAt: new Date("2026-06-14T12:00:00.000Z"),
      updatedAt: new Date("2026-06-14T12:00:00.000Z"),
      projectId: "project-1",
      projectName: "Helios CX Project",
      blueprintId: "bp-1",
      blueprintName: "Helios Exam Blueprint",
      snapshotId: "snap-1",
      snapshotName: "Default Snapshot",
      allowedRegions: [
        { id: "region-1", name: "EU West" },
        { id: "region-2", name: "US East" },
      ],
      policyId: "policy-1",
      policyName: "Standard Exam Policy",
      instructorId: "instructor-1",
      instructorName: "Helios Service Account",
    };
    createdExamIds.add(exam.id);

    await repository.save(exam);

    await expect(repository.findById(exam.id)).resolves.toEqual(exam);
    await expect(repository.listByCustomerId(customer.id)).resolves.toEqual([exam]);
  });
});
