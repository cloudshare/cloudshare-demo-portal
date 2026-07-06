import { describe, expect, it, vi } from "vitest";
import { createDiagnosticRecorder } from "@/domain/diagnostic-log";
import { createDraftExam, publishExam, type CreateDraftExamInput } from "@/domain/exam-catalog";
import type { Logger } from "@/observability/logger";
import { createInMemoryCohortExamSessionRepository } from "@/persistence/cohort-exam-session-repository";
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

async function seedPublishedExam(overrides: Partial<CreateDraftExamInput> = {}) {
  const repository = createInMemoryExamCatalogRepository();
  await createDraftExam(
    {
      repository,
      now: () => new Date("2026-07-04T10:00:00.000Z"),
      newId: () => "exam-1",
    },
    makeExamInput(overrides),
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

  it("blocks archiving a Cohort Exam catalogue item while any Cohort Exam Session is not retired", async () => {
    const repository = await seedPublishedExam({ deliveryAvailability: "cohort" });
    const cohortSessions = createInMemoryCohortExamSessionRepository();
    await cohortSessions.save({
      id: "session-published",
      customerId: "customer-1",
      examId: "exam-1",
      name: "Morning Cohort",
      admissionStartsAt: new Date("2026-07-05T09:00:00.000Z"),
      admissionEndsAt: null,
      capacity: 20,
      status: "published",
      cloudShareTrainingId: "EXcohort-1",
      cloudShareExperienceId: "EXcohort-1",
      cloudShareTeamId: "team-1",
      publishedAt: new Date("2026-07-05T09:00:00.000Z"),
      admissionClosedAt: null,
      retiredAt: null,
      lastPublishError: null,
      lastPublishCorrelationId: null,
      createdAt: new Date("2026-07-05T08:00:00.000Z"),
      updatedAt: new Date("2026-07-05T09:00:00.000Z"),
    });
    await cohortSessions.save({
      id: "session-retired",
      customerId: "customer-1",
      examId: "exam-1",
      name: "Earlier Cohort",
      admissionStartsAt: new Date("2026-07-04T09:00:00.000Z"),
      admissionEndsAt: null,
      capacity: 20,
      status: "retired",
      cloudShareTrainingId: "EXcohort-2",
      cloudShareExperienceId: "EXcohort-2",
      cloudShareTeamId: "team-1",
      publishedAt: new Date("2026-07-04T09:00:00.000Z"),
      admissionClosedAt: new Date("2026-07-04T10:00:00.000Z"),
      retiredAt: new Date("2026-07-04T10:00:00.000Z"),
      lastPublishError: null,
      lastPublishCorrelationId: null,
      createdAt: new Date("2026-07-04T08:00:00.000Z"),
      updatedAt: new Date("2026-07-04T10:00:00.000Z"),
    });
    const attempts: AdminExamArchiveAttemptRepository = {
      listByExamId: vi.fn().mockResolvedValue([]),
    };

    const response = await archiveAdminExamRuntime(
      {
        repository,
        attempts,
        cohortSessions,
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

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      error: "Retire all Cohort Exam Sessions before archiving this Cohort Exam catalogue item.",
      code: "active_cohort_sessions",
      warning: {
        totalCohortSessionCount: 2,
        activeCohortSessionCount: 1,
        activeCohortSessionStatuses: ["published"],
      },
    });
    expect(attempts.listByExamId).not.toHaveBeenCalled();
    await expect(repository.findById("exam-1")).resolves.toMatchObject({
      status: "published",
    });
  });

  it("archives a Cohort Exam catalogue item when all Cohort Exam Sessions are retired", async () => {
    const repository = await seedPublishedExam({ deliveryAvailability: "cohort" });
    const cohortSessions = createInMemoryCohortExamSessionRepository();
    await cohortSessions.save({
      id: "session-retired",
      customerId: "customer-1",
      examId: "exam-1",
      name: "Earlier Cohort",
      admissionStartsAt: new Date("2026-07-04T09:00:00.000Z"),
      admissionEndsAt: null,
      capacity: 20,
      status: "retired",
      cloudShareTrainingId: "EXcohort-2",
      cloudShareExperienceId: "EXcohort-2",
      cloudShareTeamId: "team-1",
      publishedAt: new Date("2026-07-04T09:00:00.000Z"),
      admissionClosedAt: new Date("2026-07-04T10:00:00.000Z"),
      retiredAt: new Date("2026-07-04T10:00:00.000Z"),
      lastPublishError: null,
      lastPublishCorrelationId: null,
      createdAt: new Date("2026-07-04T08:00:00.000Z"),
      updatedAt: new Date("2026-07-04T10:00:00.000Z"),
    });

    const response = await archiveAdminExamRuntime(
      {
        repository,
        attempts: {
          listByExamId: vi.fn().mockResolvedValue([]),
        },
        cohortSessions,
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
        totalAttemptCount: 0,
        totalCohortSessionCount: 1,
        activeCohortSessionCount: 0,
        activeCohortSessionStatuses: [],
      },
    });
  });
});
