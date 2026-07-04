import { describe, expect, it, vi } from "vitest";
import { createDiagnosticRecorder } from "@/domain/diagnostic-log";
import { createDraftExam, type CreateDraftExamInput } from "@/domain/exam-catalog";
import { createInMemoryCohortExamSessionRepository } from "@/persistence/cohort-exam-session-repository";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import { createInMemoryExamCatalogRepository } from "@/persistence/exam-catalog-repository";
import type { Logger } from "@/observability/logger";
import {
  handleCreateDraftCohortExamSession,
  handleGetCohortExamSession,
  handleListCohortExamSessions,
} from "./admin-cohort-exam-sessions";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

async function seedExam(
  exams: ReturnType<typeof createInMemoryExamCatalogRepository>,
  overrides: Partial<CreateDraftExamInput> = {},
) {
  await createDraftExam(
    {
      repository: exams,
      now: () => new Date("2026-07-04T10:00:00.000Z"),
      newId: () => "exam-1",
    },
    {
      customerId: "customer-1",
      title: "Helios CloudShare Fundamentals",
      description: "Hands-on exam",
      timeLimitMinutes: 240,
      storageLeaseMinutes: 2880,
      openPeriodMinutes: 720,
      scoreRetrievalEnabled: true,
      deliveryAvailability: "both",
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
      ...overrides,
    },
  );
}

describe("admin Cohort Exam Session runtime", () => {
  const actor = {
    type: "admin",
    id: "admin-1",
    email: "admin@helioscx.demo",
  } as const;

  it("creates a draft Cohort Exam Session and returns inherited Exam CloudShare context", async () => {
    const exams = createInMemoryExamCatalogRepository();
    const sessions = createInMemoryCohortExamSessionRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticsRepository });
    const audit = { write: vi.fn().mockResolvedValue(undefined) };
    await seedExam(exams);

    const response = await handleCreateDraftCohortExamSession(
      {
        exams,
        sessions,
        diagnostics,
        audit,
        logger: makeLogger(),
        now: () => new Date("2026-07-04T11:00:00.000Z"),
        newId: () => "cohort-session-1",
        newAuditId: () => "audit-1",
      },
      {
        customerId: "customer-1",
        actor,
        examId: "exam-1",
        body: {
          name: "July Admin Cohort",
          admissionStartsAt: "2026-07-05T09:00:00.000Z",
          admissionEndsAt: "2026-07-31T17:00:00.000Z",
          capacity: 25,
        },
      },
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      session: {
        id: "cohort-session-1",
        name: "July Admin Cohort",
        status: "draft",
        capacity: 25,
      },
      inheritedContext: {
        project: { id: "project-1", name: "Helios CX Project" },
        blueprint: { id: "bp-1", name: "Helios Exam Blueprint" },
        snapshot: { id: "snap-1", name: "Default Snapshot" },
        policy: { id: "policy-1", name: "Standard Exam Policy" },
        allowedRegions: [
          { id: "region-1", name: "EU West" },
          { id: "region-2", name: "US East" },
        ],
        instructor: { id: "instructor-1", name: "Helios Service Account" },
        scoreRetrievalEnabled: true,
        timeLimitMinutes: 240,
      },
    });

    const [entry] = await diagnosticsRepository.query({
      customerId: "customer-1",
      examId: "exam-1",
      operation: "cohort_exam_session.create",
    });
    expect(entry).toMatchObject({
      actor,
      subject: { type: "cohort_exam_session", id: "cohort-session-1" },
      outcome: "success",
    });
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "audit-1",
        action: "cohort_exam_session.created",
        subjectType: "cohort_exam_session",
        subjectId: "cohort-session-1",
        examId: "exam-1",
      }),
    );
  });

  it("rejects draft Cohort Exam Session creation under individual-only Exams", async () => {
    const exams = createInMemoryExamCatalogRepository();
    const sessions = createInMemoryCohortExamSessionRepository();
    await seedExam(exams, { deliveryAvailability: "individual" });

    const response = await handleCreateDraftCohortExamSession(
      {
        exams,
        sessions,
        logger: makeLogger(),
        now: () => new Date("2026-07-04T11:00:00.000Z"),
        newId: () => "cohort-session-1",
      },
      {
        customerId: "customer-1",
        actor,
        examId: "exam-1",
        body: {
          name: "July Admin Cohort",
          admissionStartsAt: "2026-07-05T09:00:00.000Z",
        },
      },
    );

    expect(response).toEqual({
      status: 409,
      body: { error: "Cohort Exam Sessions are not available for individual-only Exams." },
    });
    await expect(sessions.listByExamId("exam-1")).resolves.toEqual([]);
  });

  it("lists and views draft Cohort Exam Sessions under their parent Exam only", async () => {
    const exams = createInMemoryExamCatalogRepository();
    const sessions = createInMemoryCohortExamSessionRepository();
    await seedExam(exams);
    await handleCreateDraftCohortExamSession(
      {
        exams,
        sessions,
        logger: makeLogger(),
        now: () => new Date("2026-07-04T11:00:00.000Z"),
        newId: () => "cohort-session-1",
      },
      {
        customerId: "customer-1",
        examId: "exam-1",
        body: {
          name: "Open Cohort",
          admissionStartsAt: "2026-07-05T09:00:00.000Z",
        },
      },
    );

    const list = await handleListCohortExamSessions(
      { exams, sessions, logger: makeLogger() },
      { customerId: "customer-1", examId: "exam-1" },
    );
    const view = await handleGetCohortExamSession(
      { exams, sessions, logger: makeLogger() },
      { customerId: "customer-1", examId: "exam-1", sessionId: "cohort-session-1" },
    );
    const foreignCustomer = await handleGetCohortExamSession(
      { exams, sessions, logger: makeLogger() },
      { customerId: "customer-2", examId: "exam-1", sessionId: "cohort-session-1" },
    );

    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({
      sessions: [
        {
          session: { id: "cohort-session-1", status: "draft" },
          inheritedContext: { timeLimitMinutes: 240 },
        },
      ],
    });
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({
      session: { id: "cohort-session-1", name: "Open Cohort" },
      inheritedContext: { instructor: { name: "Helios Service Account" } },
    });
    expect(foreignCustomer.status).toBe(404);
  });
});
