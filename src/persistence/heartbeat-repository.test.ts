import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createHeartbeatRepository } from "./heartbeat-repository";

const prisma = new PrismaClient();
const repo = createHeartbeatRepository(prisma);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("HeartbeatRepository", () => {
  it("persists a heartbeat and reads it back by id", async () => {
    const saved = await repo.record("api/health");

    const found = await repo.findById(saved.id);

    expect(found).not.toBeNull();
    expect(found?.id).toBe(saved.id);
    expect(found?.source).toBe("api/health");
    expect(found?.createdAt).toBeInstanceOf(Date);
  });

  it("returns null for an unknown id", async () => {
    const found = await repo.findById("does-not-exist");
    expect(found).toBeNull();
  });
});
