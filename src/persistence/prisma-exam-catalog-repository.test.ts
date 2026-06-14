import { afterAll, afterEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPrismaExamCatalogRepository } from "./prisma-exam-catalog-repository";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(async () => {
  await prisma.exam.deleteMany();
  await prisma.customer.deleteMany({
    where: {
      slug: {
        startsWith: "exam-catalog-",
      },
    },
  });
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
    const repository = createPrismaExamCatalogRepository(prisma);
    const exam = {
      id: `exam-${suffix}`,
      customerId: customer.id,
      title: "Helios CloudShare Fundamentals",
      description: "",
      timeLimitMinutes: 240,
      scoreRetrievalEnabled: true,
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
      regionId: "region-1",
      regionName: "EU West",
      policyId: "policy-1",
      policyName: "Standard Exam Policy",
      instructorId: "instructor-1",
      instructorName: "Helios Service Account",
    };

    await repository.save(exam);

    await expect(repository.findById(exam.id)).resolves.toEqual(exam);
    await expect(repository.listByCustomerId(customer.id)).resolves.toEqual([exam]);
  });
});
