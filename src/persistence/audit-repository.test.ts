import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createInMemoryAuditRepository,
  createPrismaAuditRepository,
} from "./audit-repository";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.auditTrailEntry.deleteMany();
});

describe("createPrismaAuditRepository", () => {
  it("persists platform audit entries without requiring an ExamAttempt ID", async () => {
    const writer = createPrismaAuditRepository(prisma);
    await writer.write({
      id: "audit-admin-1",
      occurredAt: new Date("2026-07-04T10:00:00.000Z"),
      customerId: "customer-helios",
      actorType: "admin",
      actorId: "admin-1",
      actorEmail: "admin@helioscx.demo",
      action: "cloudshare_connection.updated",
      subjectType: "cloudshare_connection",
      subjectId: "customer-helios",
      outcome: "success",
      correlationId: "corr-admin-1",
      details: { changedFields: ["apiId"] },
    });

    const reader = createPrismaAuditRepository(prisma);
    const [entry] = await reader.listAll();

    expect(entry).toMatchObject({
      id: "audit-admin-1",
      occurredAt: new Date("2026-07-04T10:00:00.000Z"),
      customerId: "customer-helios",
      actorType: "admin",
      actorId: "admin-1",
      actorEmail: "admin@helioscx.demo",
      action: "cloudshare_connection.updated",
      subjectType: "cloudshare_connection",
      subjectId: "customer-helios",
      outcome: "success",
      candidateId: null,
      candidateEmail: null,
      examId: null,
      examAttemptId: null,
      correlationId: "corr-admin-1",
      details: { changedFields: ["apiId"] },
    });
  });

  it("keeps existing ExamAttempt audit lookups working on the durable model", async () => {
    const repo = createPrismaAuditRepository(prisma);
    await repo.write({
      id: "audit-runtime-1",
      occurredAt: new Date("2026-07-04T10:00:00.000Z"),
      action: "lab_suspended",
      subjectType: "exam_attempt",
      subjectId: "attempt-1",
      outcome: "success",
      examAttemptId: "attempt-1",
    });
    await repo.write({
      id: "audit-runtime-2",
      occurredAt: new Date("2026-07-04T10:01:00.000Z"),
      action: "lab_resumed",
      subjectType: "exam_attempt",
      subjectId: "attempt-2",
      outcome: "success",
      examAttemptId: "attempt-2",
    });

    await expect(repo.listByExamAttemptId("attempt-1")).resolves.toMatchObject([
      {
        id: "audit-runtime-1",
        action: "lab_suspended",
        examAttemptId: "attempt-1",
      },
    ]);
    await expect(repo.listByExamAttemptIds(["attempt-1", "attempt-2"])).resolves.toHaveLength(2);
  });

  it("filters durable audit entries and redacts secret-shaped detail fields", async () => {
    const repo = createPrismaAuditRepository(prisma);
    await repo.write({
      id: "audit-admin-1",
      occurredAt: new Date("2026-07-04T10:00:00.000Z"),
      customerId: "customer-helios",
      actorType: "admin",
      actorEmail: "ADMIN@HELIOSCX.DEMO",
      action: "cloudshare_connection.updated",
      subjectType: "cloudshare_connection",
      subjectId: "customer-helios",
      outcome: "success",
      details: {
        changedFields: ["apiKey"],
        apiKey: "secret-api-key",
        nested: { webhookSecret: "secret-webhook" },
      },
    });
    await repo.write({
      id: "audit-admin-2",
      occurredAt: new Date("2026-07-04T10:01:00.000Z"),
      customerId: "customer-other",
      actorType: "admin",
      actorEmail: "other@example.com",
      action: "exam.created",
      subjectType: "exam",
      subjectId: "exam-2",
      outcome: "success",
    });

    await expect(
      repo.query({
        customerId: "customer-helios",
        actorEmail: "admin@helioscx.demo",
        action: "cloudshare_connection.updated",
      }),
    ).resolves.toMatchObject([
      {
        id: "audit-admin-1",
        details: {
          changedFields: ["apiKey"],
          apiKey: "[REDACTED]",
          nested: { webhookSecret: "[REDACTED]" },
        },
      },
    ]);
  });
});

describe("createInMemoryAuditRepository", () => {
  it("matches the platform audit contract without requiring an ExamAttempt ID", async () => {
    const repo = createInMemoryAuditRepository();
    await repo.write({
      id: "audit-admin-1",
      occurredAt: new Date("2026-07-04T10:00:00.000Z"),
      customerId: "customer-helios",
      actorType: "admin",
      actorEmail: "admin@helioscx.demo",
      action: "exam.published",
      subjectType: "exam",
      subjectId: "exam-1",
      outcome: "success",
    });

    await expect(repo.listAll()).resolves.toMatchObject([
      {
        id: "audit-admin-1",
        action: "exam.published",
        examAttemptId: null,
      },
    ]);
  });

  it("filters and redacts with the same contract as the durable repository", async () => {
    const repo = createInMemoryAuditRepository();
    await repo.write({
      id: "audit-admin-1",
      occurredAt: new Date("2026-07-04T10:00:00.000Z"),
      customerId: "customer-helios",
      actorType: "admin",
      actorEmail: "admin@helioscx.demo",
      action: "exam.published",
      subjectType: "exam",
      subjectId: "exam-1",
      outcome: "success",
      details: { loginUrl: "https://secret.example" },
    });
    await repo.write({
      id: "audit-admin-2",
      occurredAt: new Date("2026-07-04T10:01:00.000Z"),
      customerId: "customer-helios",
      actorType: "admin",
      actorEmail: "admin@helioscx.demo",
      action: "exam.unpublished",
      subjectType: "exam",
      subjectId: "exam-1",
      outcome: "success",
    });

    await expect(repo.query({ customerId: "customer-helios", action: "exam.published" })).resolves.toMatchObject([
      {
        id: "audit-admin-1",
        details: { loginUrl: "[REDACTED]" },
      },
    ]);
  });
});
