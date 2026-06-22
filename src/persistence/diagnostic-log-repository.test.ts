import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createInMemoryDiagnosticLogRepository,
  createPrismaDiagnosticLogRepository,
} from "./diagnostic-log-repository";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.diagnosticLogEntry.deleteMany();
});

describe("createPrismaDiagnosticLogRepository", () => {
  it("persists first-class correlation fields and structured JSON across instances", async () => {
    const writer = createPrismaDiagnosticLogRepository(prisma);
    await writer.append({
      occurredAt: new Date("2026-06-20T10:00:00.000Z"),
      level: "info",
      source: "candidate-portal",
      operation: "candidate.account.create",
      outcome: "success",
      customerId: "cust_1",
      actor: { type: "candidate", email: "person@example.com" },
      subject: { type: "candidate", id: "user_1" },
      message: "candidate account created",
      correlationId: "corr_1",
      candidateEmail: "person@example.com",
      examId: "exam_1",
      examAttemptId: "att_1",
      externalIds: { environmentId: "env_1" },
      request: { method: "POST" },
      response: { status: 201 },
      details: { note: "ok" },
    });

    const reader = createPrismaDiagnosticLogRepository(prisma);
    const [entry] = await reader.query({ customerId: "cust_1" });

    expect(entry).toMatchObject({
      occurredAt: new Date("2026-06-20T10:00:00.000Z"),
      level: "info",
      source: "candidate-portal",
      operation: "candidate.account.create",
      outcome: "success",
      customerId: "cust_1",
      actor: { type: "candidate", id: null, email: "person@example.com" },
      subject: { type: "candidate", id: "user_1" },
      message: "candidate account created",
      correlationId: "corr_1",
      candidateEmail: "person@example.com",
      examId: "exam_1",
      examAttemptId: "att_1",
      externalIds: { environmentId: "env_1" },
      request: { method: "POST" },
      response: { status: 201 },
      details: { note: "ok" },
    });
    expect(typeof entry.id).toBe("string");
  });

  it("isolates entries by Customer", async () => {
    const repo = createPrismaDiagnosticLogRepository(prisma);
    await repo.append({
      source: "auth",
      operation: "portal.login",
      outcome: "success",
      message: "a",
      customerId: "cust_a",
    });
    await repo.append({
      source: "auth",
      operation: "portal.login",
      outcome: "success",
      message: "b",
      customerId: "cust_b",
    });

    const onlyA = await repo.query({ customerId: "cust_a" });
    expect(onlyA).toHaveLength(1);
    expect(onlyA[0].customerId).toBe("cust_a");
  });

  it("filters by time range and returns newest first", async () => {
    const repo = createPrismaDiagnosticLogRepository(prisma);
    for (const minute of [0, 1, 2]) {
      await repo.append({
        occurredAt: new Date(`2026-06-20T10:0${minute}:00.000Z`),
        source: "auth",
        operation: "portal.login",
        outcome: "success",
        message: `m${minute}`,
        customerId: "cust_1",
      });
    }

    const windowed = await repo.query({
      customerId: "cust_1",
      from: new Date("2026-06-20T10:01:00.000Z"),
      to: new Date("2026-06-20T10:02:00.000Z"),
    });
    expect(windowed.map((e) => e.message)).toEqual(["m2", "m1"]);
  });

  it("bounds reads to the requested (capped) limit", async () => {
    const repo = createPrismaDiagnosticLogRepository(prisma);
    for (let i = 0; i < 5; i++) {
      await repo.append({
        occurredAt: new Date(`2026-06-20T10:00:0${i}.000Z`),
        source: "auth",
        operation: "portal.login",
        outcome: "success",
        message: `m${i}`,
        customerId: "cust_1",
      });
    }
    const limited = await repo.query({ customerId: "cust_1", limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it("filters by first-class and correlated support fields", async () => {
    const repo = createPrismaDiagnosticLogRepository(prisma);
    await repo.append({
      occurredAt: new Date("2026-06-20T10:00:00.000Z"),
      source: "runtime",
      operation: "exam_attempt.resume",
      outcome: "failure",
      message: "match",
      customerId: "cust_1",
      candidateEmail: "candidate@helioscx.demo",
      correlationId: "corr-1",
      externalIds: { environmentId: "env-1" },
      details: { integrationSurface: "cloudshare.v4.environment" },
    });
    await repo.append({
      occurredAt: new Date("2026-06-20T10:01:00.000Z"),
      source: "runtime",
      operation: "exam_attempt.resume",
      outcome: "success",
      message: "other",
      customerId: "cust_1",
      candidateEmail: "other@helioscx.demo",
      correlationId: "corr-2",
      externalIds: { environmentId: "env-2" },
      details: { integrationSurface: "cloudshare.v4.environment" },
    });

    const matched = await repo.query({
      customerId: "cust_1",
      candidateEmail: "candidate@helioscx.demo",
      outcome: "failure",
      correlationId: "corr-1",
      integrationSurface: "cloudshare.v4.environment",
      externalId: "env-1",
    });

    expect(matched).toHaveLength(1);
    expect(matched[0].message).toBe("match");
  });

  it("supports offset pagination", async () => {
    const repo = createPrismaDiagnosticLogRepository(prisma);
    for (let i = 0; i < 4; i++) {
      await repo.append({
        occurredAt: new Date(`2026-06-20T10:00:0${i}.000Z`),
        source: "auth",
        operation: "portal.login",
        outcome: "success",
        message: `m${i}`,
        customerId: "cust_1",
      });
    }

    const paged = await repo.query({ customerId: "cust_1", limit: 2, offset: 1 });
    expect(paged.map((entry) => entry.message)).toEqual(["m2", "m1"]);
  });
});

describe("createInMemoryDiagnosticLogRepository", () => {
  it("matches the Prisma repository contract for query filtering", async () => {
    const repo = createInMemoryDiagnosticLogRepository();
    await repo.append({
      source: "auth",
      operation: "portal.login",
      outcome: "success",
      message: "a",
      customerId: "cust_a",
      occurredAt: new Date("2026-06-20T10:00:00.000Z"),
    });
    await repo.append({
      source: "auth",
      operation: "portal.login",
      outcome: "failure",
      message: "b",
      customerId: "cust_b",
      occurredAt: new Date("2026-06-20T10:01:00.000Z"),
    });

    expect(await repo.query({ customerId: "cust_a" })).toHaveLength(1);
    expect((await repo.query())[0].message).toBe("b");
  });

  it("matches the Prisma repository contract for correlated filters and paging", async () => {
    const repo = createInMemoryDiagnosticLogRepository();
    await repo.append({
      occurredAt: new Date("2026-06-20T10:00:00.000Z"),
      source: "runtime",
      operation: "exam_attempt.resume",
      outcome: "failure",
      message: "match",
      customerId: "cust_1",
      candidateEmail: "candidate@helioscx.demo",
      correlationId: "corr-1",
      externalIds: { environmentId: "env-1" },
      details: { integrationSurface: "cloudshare.v4.environment" },
    });
    await repo.append({
      occurredAt: new Date("2026-06-20T10:00:01.000Z"),
      source: "runtime",
      operation: "exam_attempt.resume",
      outcome: "failure",
      message: "later",
      customerId: "cust_1",
      candidateEmail: "candidate@helioscx.demo",
      correlationId: "corr-2",
      externalIds: { environmentId: "env-2" },
      details: { integrationSurface: "cloudshare.v4.environment" },
    });

    expect(
      await repo.query({
        customerId: "cust_1",
        candidateEmail: "candidate@helioscx.demo",
        correlationId: "corr-1",
        integrationSurface: "cloudshare.v4.environment",
        externalId: "env-1",
      }),
    ).toHaveLength(1);
    expect(
      (await repo.query({ customerId: "cust_1", limit: 1, offset: 1 }))[0].message,
    ).toBe("match");
  });
});
