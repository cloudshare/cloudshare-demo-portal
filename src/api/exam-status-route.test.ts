import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../app/api/exam/status/route";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";
import { createInMemoryExamCatalogRepository } from "@/persistence/exam-catalog-repository";
import { createExamClock, createInMemoryExamClockRepository } from "@/domain/exam-clock";
import { createDraftExam, publishExam } from "@/domain/exam-catalog";
import { createDiagnosticRecorder } from "@/domain/diagnostic-log";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";

const {
  mockCookies,
  mockGetServices,
  mockGetPortalSession,
} = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockGetServices: vi.fn(),
  mockGetPortalSession: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mockCookies,
}));

vi.mock("@/composition", () => ({
  getServices: mockGetServices,
}));

vi.mock("@/auth/portal-session", () => ({
  getPortalSession: mockGetPortalSession,
}));

describe("exam status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({
      get: () => ({ value: "portal-session-1" }),
    });
  });

  it("writes durable completion diagnostics through the real /api/exam/status route without changing the candidate response", async () => {
    const exams = createInMemoryExamCatalogRepository();
    const attempts = createInMemoryExamAttemptRepository();
    const clockRepository = createInMemoryExamClockRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnosticRecorder = createDiagnosticRecorder({ repository: diagnosticsRepository });
    const clocks = createExamClock({
      clocks: clockRepository,
      now: () => new Date("2026-06-18T10:00:30.000Z"),
    });

    await createDraftExam(
      {
        repository: exams,
        now: () => new Date("2026-06-18T08:00:00.000Z"),
        newId: () => "exam-1",
      },
      {
        customerId: "customer-1",
        title: "Helios Guided Journey",
        description: "Hands-on exam",
        timeLimitMinutes: 60,
        scoreRetrievalEnabled: true,
        projectId: "project-1",
        projectName: "Helios CX",
        blueprintId: "bp-1",
        blueprintName: "Helios Guided Journey",
        snapshotId: "snap-1",
        snapshotName: "Default Snapshot",
        allowedRegions: [{ id: "region-1", name: "EU West" }],
        policyId: "policy-1",
        policyName: "Standard Policy",
        instructorId: "instructor-1",
        instructorName: "Helios Service Account",
      },
    );
    await publishExam(
      { repository: exams, now: () => new Date("2026-06-18T08:05:00.000Z") },
      { customerId: "customer-1", examId: "exam-1" },
    );

    await attempts.save({
      id: "attempt-1",
      customerId: "customer-1",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "in_progress",
      scheduledFor: new Date("2026-06-18T09:00:00.000Z"),
      createdAt: new Date("2026-06-18T08:55:00.000Z"),
    });
    await clockRepository.save({
      examAttemptId: "attempt-1",
      status: "running",
      elapsedAtPauseMs: 59 * 60 * 1000,
      startedAt: new Date("2026-06-18T09:59:30.000Z"),
      updatedAt: new Date("2026-06-18T09:59:30.000Z"),
    });

    mockGetServices.mockReturnValue({
      examAttempts: attempts,
      exams,
      examClock: clocks,
      diagnosticRecorder,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    mockGetPortalSession.mockResolvedValue({
      sessionId: "portal-session-1",
      userId: "candidate-1",
      customerId: "customer-1",
      role: "candidate",
      email: "candidate@example.com",
      issuedAtMs: 1,
    });

    const response = await GET(
      new Request("http://localhost:3000/api/exam/status?examAttemptId=attempt-1"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      examAttemptId: "attempt-1",
      examTitle: "Helios Guided Journey",
      timeLimitMinutes: 60,
      status: "completed",
      scheduledFor: "2026-06-18T09:00:00.000Z",
    });
    await expect(
      diagnosticsRepository.query({ customerId: "customer-1", examAttemptId: "attempt-1" }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "exam_attempt.complete",
          outcome: "success",
          customerId: "customer-1",
          candidateEmail: null,
          examId: "exam-1",
          examAttemptId: "attempt-1",
        }),
      ]),
    );
  });
});
