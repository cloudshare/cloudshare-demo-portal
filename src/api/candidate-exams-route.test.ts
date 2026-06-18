import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../app/api/candidate/exams/route";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";
import { createInMemoryExamCatalogRepository } from "@/persistence/exam-catalog-repository";
import { createExamClock, createInMemoryExamClockRepository } from "@/domain/exam-clock";
import { createDraftExam, publishExam } from "@/domain/exam-catalog";

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

describe("candidate exams route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({
      get: () => ({ value: "portal-session-1" }),
    });
  });

  it("reconciles expired-by-clock attempts to completed through the real candidate dashboard route", async () => {
    const exams = createInMemoryExamCatalogRepository();
    const attempts = createInMemoryExamAttemptRepository();
    const clockRepository = createInMemoryExamClockRepository();
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
      ensurePortalSeeded: vi.fn().mockResolvedValue(undefined),
      exams,
      examAttempts: attempts,
      examClock: clocks,
      labLaunches: { findByExamAttemptId: vi.fn().mockResolvedValue(null) },
      cloudshareConnections: { findByCustomerId: vi.fn().mockResolvedValue(null) },
      cloudshareClientFactory: { forConnection: vi.fn() },
      eventLog: { append: vi.fn() },
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

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      exams: [
        {
          id: "exam-1",
          title: "Helios Guided Journey",
          description: "Hands-on exam",
          timeLimitMinutes: 60,
        },
      ],
      attempts: [
        {
          id: "attempt-1",
          examId: "exam-1",
          scheduledFor: "2026-06-18T09:00:00.000Z",
          status: "completed",
        },
      ],
    });
  });
});
