import { afterAll, afterEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPrismaEnvironmentRepository } from "./prisma-environment-repository";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(async () => {
  await prisma.environmentRecord.deleteMany({
    where: {
      environmentExternalId: {
        startsWith: "env-repo-",
      },
    },
  });
});

describe("PrismaEnvironmentRepository", () => {
  it("keeps the fresher observedAt reading when an older write arrives later", async () => {
    const repository = createPrismaEnvironmentRepository(prisma);
    const environmentExternalId = `env-repo-${Date.now()}`;

    await repository.save({
      environmentExternalId,
      status: "running",
      observedAt: new Date("2026-06-15T16:00:05.000Z"),
    });
    await repository.save({
      environmentExternalId,
      status: "suspended",
      observedAt: new Date("2026-06-15T16:00:00.000Z"),
    });

    await expect(repository.findByExternalId(environmentExternalId)).resolves.toEqual({
      environmentExternalId,
      status: "running",
      observedAt: new Date("2026-06-15T16:00:05.000Z"),
    });
  });
});
