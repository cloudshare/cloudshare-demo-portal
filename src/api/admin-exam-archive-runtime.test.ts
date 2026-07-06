import { describe, expect, it, vi } from "vitest";
import { createDiagnosticRecorder } from "@/domain/diagnostic-log";
import { createDraftExam, publishExam, type CreateDraftExamInput } from "@/domain/exam-catalog";
import type { Logger } from "@/observability/logger";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import { createInMemoryExamCatalogRepository } from "@/persistence/exam-catalog-repository";
import {
  archiveAdminExamRuntime,
  type AdminExamArchiveAttemptRepository,
} from "./admin-exam-archive-runtime";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeExamInput(overrides: Partial<CreateDraftExamInput> = {}): CreateDraftExamInput {
  return {
    customerId: "customer-1",
    title: "Helios CloudShare Fundamentals",
    description: "Hands-on exam",
    timeLimitMinutes: 240,
    storageLeaseMinutes: 2880,
    openPeriodMinutes: 720,
    scoreRetrievalEnabled: true,
    deliveryAvailability: "individual",
    projectId: "project-1",
    projectName: "Helios CX Project",
    blueprintId: "bp-1",
    blueprintName: "Helios Exam Blueprint",
    snapshotId: "snap-1",
    snapshotName: "Default Snapshot",
    allowedRegions: [{ id: "region-1", name: "EU West" }],
    policyId: "policy-1",
    policyName: "Standard Exam Policy",
    instructorId: "instructor-1",
    instructorName: "Helios Service Account",
    ...overrides,
  };
}

async function seedPublishedExam() {
  const repository = createInMemoryExamCatalogRepository();
  await createDraftExam(
    {
      repository,
      now: () => new Date("2026-07-04T10:00:00.000Z"),
      newId: () => "exam-1",
    },
    makeExamInput(),
  );
  await publishExam(
    { repository, now: () => new Date("2026-07-04T10:05:00.000Z") },
    { customerId: "customer-1", examId: "exam-1" },
  );
  return repository;
}

describe("archiveAdminExamRuntime", () => {
  const actor = {
    type: "admin",
    id: "admin-1",
    email: "admin@helioscx.demo",
  } as const;

  it("requires confirmation before archiving an Individual Exam with scheduled or active attempts", async () => {
    const repository = await seedPublishedExam();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticsRepository });
    const attempts: AdminExamArchiveAttemptRepository = {
      listByExamId: vi.fn().mockResolvedValue([
        { id: "attempt-scheduled", status: "scheduled", cohortSessionId: null },
        { id: "attempt-running", status: "in_progress", cohortSessionId: null },
        { id: "attempt-completed", status: "completed", cohortSessionId: null },
      ]),
    };

    const warning = await archiveAdminExamRuntime(
      {
        repository,
        attempts,
        diagnostics,
        logger: makeLogger(),
        now: () => new Date("2026-07-05T10:00:00.000Z"),
      },
      {
        customerId: "customer-1",
        actor,
        examId: "exam-1",
        body: {},
      },
    );

    expect(warning.status).toBe(409);
    expect(warning.body).toMatchObject({
      error: "Active or scheduled attempts may still rely on this Exam.",
      code: "confirmation_required",
      warning: {
        scheduledAttemptCount: 1,
        activeAttemptCount: 1,
        totalAttemptCount: 3,
      },
    });

    const archived = await archiveAdminExamRuntime(
      {
        repository,
        attempts,
        diagnostics,
        logger: makeLogger(),
        now: () => new Date("2026-07-05T10:00:00.000Z"),
        newAuditId: () => "audit-archive-1",
        audit: { write: vi.fn().mockResolvedValue(undefined) },
      },
      {
        customerId: "customer-1",
        actor,
        examId: "exam-1",
        body: { confirmArchive: true },
      },
    );

    expect(archived.status).toBe(200);
    expect(archived.body).toMatchObject({
      exam: {
        id: "exam-1",
        status: "archived",
      },
      warning: {
        scheduledAttemptCount: 1,
        activeAttemptCount: 1,
        totalAttemptCount: 3,
      },
    });
    await expect(repository.findById("exam-1")).resolves.toMatchObject({
      status: "archived",
    });
    const [entry] = await diagnosticsRepository.query({
      customerId: "customer-1",
      examId: "exam-1",
      operation: "exam.archive",
    });
    expect(entry).toMatchObject({
      actor,
      outcome: "success",
      details: {
        scheduledAttemptCount: 1,
        activeAttemptCount: 1,
        totalAttemptCount: 3,
        changedFields: ["status"],
      },
    });
  });

  it("archives a published Individual Exam without warning when no active or scheduled attempts remain", async () => {
    const repository = await seedPublishedExam();
    const attempts: AdminExamArchiveAttemptRepository = {
      listByExamId: vi.fn().mockResolvedValue([
        { id: "attempt-completed", status: "completed", cohortSessionId: null },
        { id: "attempt-expired", status: "expired", cohortSessionId: null },
      ]),
    };

    const response = await archiveAdminExamRuntime(
      {
        repository,
        attempts,
        logger: makeLogger(),
        now: () => new Date("2026-07-05T10:00:00.000Z"),
      },
      {
        customerId: "customer-1",
        actor,
        examId: "exam-1",
        body: {},
      },
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      exam: {
        id: "exam-1",
        status: "archived",
      },
      warning: {
        scheduledAttemptCount: 0,
        activeAttemptCount: 0,
        totalAttemptCount: 2,
      },
    });
  });
});
