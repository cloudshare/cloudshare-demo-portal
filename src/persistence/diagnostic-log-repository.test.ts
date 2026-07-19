import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  PRISMA_DIAGNOSTIC_SCAN_BATCH_SIZE,
  createInMemoryDiagnosticLogRepository,
  createPrismaDiagnosticLogRepository,
} from "./diagnostic-log-repository";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  // This suite shares SQLite with parallel persistence tests. Restrict cleanup
  // to its fixed fixture Customers so it cannot erase another test's evidence.
  await prisma.diagnosticLogEntry.deleteMany({ where: { customerId: { in: ["cust_1", "cust_a", "cust_b"] } } });
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
      subject: { type: "sales_session_participant", id: "participant-1" },
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
      subject: { type: "sales_session_participant", id: "participant-2" },
      externalIds: { environmentId: "env-2" },
      details: { integrationSurface: "cloudshare.v4.environment" },
    });

    const matched = await repo.query({
      customerId: "cust_1",
      candidateEmail: "candidate@helioscx.demo",
      outcome: "failure",
      correlationId: "corr-1",
      subjectId: "participant-1",
      integrationSurface: "cloudshare.v4.environment",
      externalId: "env-1",
    });

    expect(matched).toHaveLength(1);
    expect(matched[0].message).toBe("match");
  });

  it("scopes participant diagnostics by both Customer and subject ID", async () => {
    const repo = createPrismaDiagnosticLogRepository(prisma);
    for (const [customerId, subjectId, message] of [
      ["cust_1", "participant-1", "selected-first"],
      ["cust_1", "participant-1", "selected-second"],
      ["cust_1", "participant-2", "other-participant"],
      ["cust_2", "participant-1", "wrong-customer"],
    ] as const) {
      await repo.append({ source: "sales-participant-launch", operation: "sales.demo_session.participant_launch.opened", outcome: "success", message, customerId, subject: { type: "sales_session_participant", id: subjectId } });
    }

    const matched = await repo.query({ customerId: "cust_1", subjectId: "participant-1" });
    expect(matched.map((entry) => entry.message)).toEqual(["selected-second", "selected-first"]);
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

  it("does exact externalId filtering before pagination so env-1 is not lost behind env-10", async () => {
    const repo = createPrismaDiagnosticLogRepository(prisma);
    await repo.append({
      occurredAt: new Date("2026-06-20T10:02:00.000Z"),
      source: "runtime",
      operation: "exam_attempt.resume",
      outcome: "failure",
      message: "env-10 newer",
      customerId: "cust_1",
      externalIds: { environmentId: "env-10" },
      details: { integrationSurface: "cloudshare.v4.environment" },
    });
    await repo.append({
      occurredAt: new Date("2026-06-20T10:01:00.000Z"),
      source: "runtime",
      operation: "exam_attempt.resume",
      outcome: "failure",
      message: "env-1 exact",
      customerId: "cust_1",
      externalIds: { environmentId: "env-1" },
      details: { integrationSurface: "cloudshare.v4.environment" },
    });

    const page = await repo.query({
      customerId: "cust_1",
      integrationSurface: "cloudshare.v4.environment",
      externalId: "env-1",
      limit: 1,
      offset: 0,
    });

    expect(page.map((entry) => entry.message)).toEqual(["env-1 exact"]);
  });

  it("matches candidate email case-insensitively even when the stored row uses mixed case", async () => {
    const repo = createPrismaDiagnosticLogRepository(prisma);
    await repo.append({
      occurredAt: new Date("2026-06-20T10:00:00.000Z"),
      source: "runtime",
      operation: "exam_attempt.resume",
      outcome: "success",
      message: "mixed-case email",
      customerId: "cust_1",
      candidateEmail: "Candidate@HeliosCX.demo",
    });

    const matched = await repo.query({
      customerId: "cust_1",
      candidateEmail: "candidate@helioscx.demo",
    });

    expect(matched).toHaveLength(1);
    expect(matched[0].message).toBe("mixed-case email");
  });

  it("uses bounded batch scans for exact post-filter queries instead of reading the whole result set at once", async () => {
    const rows = Array.from({ length: PRISMA_DIAGNOSTIC_SCAN_BATCH_SIZE + 20 }, (_, index) => ({
      id: `diag-${index}`,
      occurredAt: new Date(`2026-06-20T10:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`),
      level: "info",
      source: "runtime",
      operation: "exam_attempt.resume",
      outcome: "success",
      customerId: "cust_1",
      actorType: null,
      actorId: null,
      actorEmail: null,
      subjectType: null,
      subjectId: null,
      message: `row-${index}`,
      correlationId: null,
      candidateEmail: index === PRISMA_DIAGNOSTIC_SCAN_BATCH_SIZE + 5 ? "Candidate@HeliosCX.demo" : null,
      examId: null,
      examAttemptId: null,
      externalIdsJson:
        index === PRISMA_DIAGNOSTIC_SCAN_BATCH_SIZE + 5
          ? JSON.stringify({ environmentId: "env-1" })
          : JSON.stringify({ environmentId: `env-${index}` }),
      requestJson: null,
      responseJson: null,
      detailsJson:
        index === PRISMA_DIAGNOSTIC_SCAN_BATCH_SIZE + 5
          ? JSON.stringify({ integrationSurface: "cloudshare.v4.environment" })
          : JSON.stringify({ integrationSurface: "cloudshare.v4.other" }),
    }));
    const findMany = async (args: { skip?: number; take?: number }) => {
      expect(args.take).toBe(PRISMA_DIAGNOSTIC_SCAN_BATCH_SIZE);
      const skip = args.skip ?? 0;
      return rows.slice(skip, skip + (args.take ?? 0));
    };

    const repo = createPrismaDiagnosticLogRepository({
      diagnosticLogEntry: {
        create: async () => {
          throw new Error("unused");
        },
        findMany,
        deleteMany: async () => ({ count: 0 }),
      },
    } as unknown as PrismaClient);

    const matched = await repo.query({
      customerId: "cust_1",
      candidateEmail: "candidate@helioscx.demo",
      integrationSurface: "cloudshare.v4.environment",
      externalId: "env-1",
      limit: 1,
    });

    expect(matched).toHaveLength(1);
    expect(matched[0].message).toBe(`row-${PRISMA_DIAGNOSTIC_SCAN_BATCH_SIZE + 5}`);
  });
});

describe("createInMemoryDiagnosticLogRepository protected evidence contract", () => {
  it("retains authorized request and provider-response bodies exactly", async () => {
    const repository = createInMemoryDiagnosticLogRepository();
    const requestBody = { marker: "synthetic-request-marker", nested: ["exact"] };
    const responseBody = { marker: "synthetic-response-marker", nested: ["exact"] };

    await repository.append({
      source: "cloudshare",
      operation: "cloudshare.contract_probe",
      outcome: "failure",
      customerId: "cust_1",
      message: "contract probe",
      correlationId: "corr-contract-probe",
      request: { body: requestBody },
      response: { body: responseBody },
    });

    const [entry] = await repository.query({ customerId: "cust_1" });
    expect(entry.request?.body).toEqual(requestBody);
    expect(entry.response?.body).toEqual(responseBody);
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

  it("matches the Prisma contract for exact externalId pagination", async () => {
    const repo = createInMemoryDiagnosticLogRepository();
    await repo.append({
      occurredAt: new Date("2026-06-20T10:02:00.000Z"),
      source: "runtime",
      operation: "exam_attempt.resume",
      outcome: "failure",
      message: "env-10 newer",
      customerId: "cust_1",
      externalIds: { environmentId: "env-10" },
      details: { integrationSurface: "cloudshare.v4.environment" },
    });
    await repo.append({
      occurredAt: new Date("2026-06-20T10:01:00.000Z"),
      source: "runtime",
      operation: "exam_attempt.resume",
      outcome: "failure",
      message: "env-1 exact",
      customerId: "cust_1",
      externalIds: { environmentId: "env-1" },
      details: { integrationSurface: "cloudshare.v4.environment" },
    });

    expect(
      await repo.query({
        customerId: "cust_1",
        integrationSurface: "cloudshare.v4.environment",
        externalId: "env-1",
        limit: 1,
      }),
    ).toMatchObject([expect.objectContaining({ message: "env-1 exact" })]);
  });
});
