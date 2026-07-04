import { describe, expect, it, vi } from "vitest";
import { createExamClock, createInMemoryExamClockRepository } from "@/domain/exam-clock";
import { createDraftExam, publishExam } from "@/domain/exam-catalog";
import type { HeartbeatAutoSuspend } from "@/domain/heartbeat-auto-suspend";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";
import { createInMemoryExamCatalogRepository } from "@/persistence/exam-catalog-repository";
import { createInMemoryLabLaunchRepository } from "@/persistence/lab-launch-repository";
import {
  getCandidateLabStatusRuntime,
  recordExamAttemptHeartbeatRuntime,
} from "./exam-attempt-heartbeat-status-runtime";

function makeAutoSuspend(): HeartbeatAutoSuspend {
  return {
    recordHeartbeat: vi.fn(),
    removeHeartbeat: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    checkAll: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
  };
}

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

async function makePublishedExam() {
  const exams = createInMemoryExamCatalogRepository();
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
      timeLimitMinutes: 90,
      openPeriodMinutes: 120,
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
  return exams;
}

describe("recordExamAttemptHeartbeatRuntime", () => {
  it("surfaces completion once clock reconciliation consumes the runtime and removes heartbeat state", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const clockRepository = createInMemoryExamClockRepository();
    const launches = createInMemoryLabLaunchRepository();
    const autoSuspend = makeAutoSuspend();
    const diagnostics = { record: vi.fn().mockResolvedValue(undefined) };
    const audit = {
      write: vi.fn().mockResolvedValue(undefined),
      listByExamAttemptId: vi.fn().mockResolvedValue([]),
      listByExamAttemptIds: vi.fn().mockResolvedValue([]),
      listAll: vi.fn().mockResolvedValue([]),
    };
    const cloudshareClient = {
      requestV4Detailed: vi.fn().mockResolvedValue({
        data: {
          exploredRate: 0.25,
          inProgressRate: 0,
          notStartedRate: 0.75,
          passedRate: 0,
          failedRate: 1,
          notInitiatedRate: 0,
          sectionStatuses: [
            { number: 0, name: "Last section", status: "notStarted" },
            { number: 0, name: "Check pfSense WAN Interface", status: "explored" },
            { number: 1, name: "Check the LAN interface", status: "notStarted" },
            { number: 2, name: "Section Name 3", status: "notStarted" },
          ],
        },
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.guided_journey.progress",
        request: {
          method: "GET",
          path: "/guided-journey/progress/EXtraining-1/student-1",
        },
        response: {
          status: 200,
          body: {
            passedRate: 0,
            failedRate: 1,
          },
        },
      }),
    };
    const cloudshareConnections = {
      save: vi.fn(),
      markVerified: vi.fn(),
      findByWebhookPathToken: vi.fn(),
      findByCustomerId: vi.fn().mockResolvedValue({
        customerId: "customer-1",
        apiId: "api-id",
        apiKey: "api-key",
        webhookSecret: "webhook-secret",
        webhookPathToken: "whk-customer-1",
        connectedAt: new Date("2026-06-18T08:00:00.000Z"),
        verifiedAt: new Date("2026-06-18T08:05:00.000Z"),
      }),
    };
    const cloudshareClientFactory = {
      forConnection: vi.fn().mockReturnValue(cloudshareClient),
    };
    const clocks = createExamClock({
      clocks: clockRepository,
      now: () => new Date("2026-06-18T10:30:00.000Z"),
    });

    await attempts.save({
      id: "ea-1",
      customerId: "customer-1",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "in_progress",
      scheduledFor: new Date("2026-06-18T09:00:00.000Z"),
      createdAt: new Date("2026-06-18T08:55:00.000Z"),
    });
    await clockRepository.save({
      examAttemptId: "ea-1",
      status: "running",
      elapsedAtPauseMs: 89 * 60 * 1000,
      startedAt: new Date("2026-06-18T10:29:00.000Z"),
      updatedAt: new Date("2026-06-18T10:29:00.000Z"),
    });
    const launch = {
      id: "launch-1",
      examAttemptId: "ea-1",
      candidateId: "candidate-1",
      participantEmail: "candidate@example.com",
      participantId: "student-1",
      trainingId: "EXtraining-1",
      experienceId: "EXtraining-1",
      loginUrl: "https://use.cloudshare.com/secret-sponsored-link",
      status: "launched" as const,
      createdAt: new Date("2026-06-18T08:56:00.000Z"),
    };
    await launches.save(launch);

    const response = await recordExamAttemptHeartbeatRuntime(
      {
        attempts,
        exams: await makePublishedExam(),
        clocks,
        autoSuspend,
        launches,
        audit,
        diagnostics,
        logger: makeLogger(),
        candidateEmail: "candidate@example.com",
        connections: cloudshareConnections,
        cloudshare: cloudshareClientFactory,
      },
      {
        examAttemptId: "ea-1",
        candidateId: "candidate-1",
        launch,
      },
    );

    expect(response).toEqual({
      status: 200,
      body: { status: "completed", attemptStatus: "completed" },
    });
    expect(autoSuspend.recordHeartbeat).not.toHaveBeenCalled();
    expect(autoSuspend.removeHeartbeat).toHaveBeenCalledWith("ea-1");
    expect(diagnostics.record).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "exam_attempt.completed",
        outcome: "success",
        customerId: "customer-1",
        candidateEmail: "candidate@example.com",
        examId: "exam-1",
        examAttemptId: "ea-1",
        details: { reason: "heartbeat_reconciliation" },
      }),
    );
    expect(diagnostics.record).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "exam_attempt.score.retrieve",
        outcome: "success",
        response: expect.objectContaining({
          scoreAvailable: true,
          percentComplete: 25,
          passedRate: 0,
          failedRate: 1,
        }),
      }),
    );
  });

  it("records an in-progress heartbeat and returns the authoritative post-heartbeat attempt status", async () => {
    const inProgressAttempt = {
      id: "ea-1",
      customerId: "customer-1",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "in_progress" as const,
      scheduledFor: new Date("2026-06-18T09:00:00.000Z"),
      createdAt: new Date("2026-06-18T08:55:00.000Z"),
    };
    const suspendedAttempt = {
      ...inProgressAttempt,
      status: "suspended" as const,
    };
    const attempts = {
      save: vi.fn(),
      findById: vi.fn()
        .mockResolvedValueOnce(inProgressAttempt)
        .mockResolvedValueOnce(inProgressAttempt)
        .mockResolvedValueOnce(suspendedAttempt),
      listByCandidate: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const autoSuspend = makeAutoSuspend();
    const diagnostics = { record: vi.fn().mockResolvedValue(undefined) };

    const response = await recordExamAttemptHeartbeatRuntime(
      {
        attempts,
        exams: await makePublishedExam(),
        autoSuspend,
        diagnostics,
        logger: makeLogger(),
        candidateEmail: "candidate@example.com",
      },
      {
        examAttemptId: "ea-1",
        candidateId: "candidate-1",
        launch: null,
      },
    );

    expect(response).toEqual({
      status: 200,
      body: { status: "ok", attemptStatus: "suspended" },
    });
    expect(autoSuspend.recordHeartbeat).toHaveBeenCalledWith("ea-1");
    expect(autoSuspend.removeHeartbeat).not.toHaveBeenCalled();
    expect(diagnostics.record).toHaveBeenCalledWith({
      source: "runtime",
      customerId: "customer-1",
      candidateEmail: "candidate@example.com",
      examId: "exam-1",
      examAttemptId: "ea-1",
      level: "info",
      operation: "exam_attempt.heartbeat.receive",
      outcome: "success",
      message: "Heartbeat received for in-progress exam attempt",
      actor: { type: "candidate", id: "candidate-1", email: "candidate@example.com" },
      subject: { type: "exam_attempt", id: "ea-1" },
      details: { route: "/api/heartbeat" },
    });
  });
});

describe("getCandidateLabStatusRuntime", () => {
  it("returns candidate-safe lab status after completion reconciliation", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const clockRepository = createInMemoryExamClockRepository();
    const clocks = createExamClock({
      clocks: clockRepository,
      now: () => new Date("2026-06-18T10:30:00.000Z"),
    });

    await attempts.save({
      id: "ea-1",
      customerId: "customer-1",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "in_progress",
      scheduledFor: new Date("2026-06-18T09:00:00.000Z"),
      createdAt: new Date("2026-06-18T08:55:00.000Z"),
    });
    await clockRepository.save({
      examAttemptId: "ea-1",
      status: "running",
      elapsedAtPauseMs: 89 * 60 * 1000,
      startedAt: new Date("2026-06-18T10:29:00.000Z"),
      updatedAt: new Date("2026-06-18T10:29:00.000Z"),
    });

    const response = await getCandidateLabStatusRuntime(
      {
        attempts,
        exams: await makePublishedExam(),
        clocks,
        diagnostics: { record: vi.fn().mockResolvedValue(undefined) },
        now: () => new Date("2026-06-18T10:30:00.000Z"),
        logger: makeLogger(),
      },
      {
        examAttemptId: "ea-1",
        candidateId: "candidate-1",
      },
    );

    expect(response).toEqual({
      status: 200,
      body: {
        examAttemptId: "ea-1",
        examTitle: "Helios Guided Journey",
        timeLimitMinutes: 90,
        openPeriodMinutes: 120,
        openPeriodEndsAt: "2026-06-18T11:00:00.000Z",
        openPeriodClosed: false,
        scoreRetrievalEnabled: true,
        status: "completed",
        scheduledFor: "2026-06-18T09:00:00.000Z",
      },
    });
  });

  it("returns authored open-period closure context for stale lab pages", async () => {
    const attempts = createInMemoryExamAttemptRepository();

    await attempts.save({
      id: "ea-1",
      customerId: "customer-1",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "suspended",
      scheduledFor: new Date("2026-06-18T09:00:00.000Z"),
      createdAt: new Date("2026-06-18T08:55:00.000Z"),
    });

    const response = await getCandidateLabStatusRuntime(
      {
        attempts,
        exams: await makePublishedExam(),
        now: () => new Date("2026-06-18T11:00:00.000Z"),
        logger: makeLogger(),
      },
      {
        examAttemptId: "ea-1",
        candidateId: "candidate-1",
      },
    );

    expect(response).toEqual({
      status: 200,
      body: {
        examAttemptId: "ea-1",
        examTitle: "Helios Guided Journey",
        timeLimitMinutes: 90,
        openPeriodMinutes: 120,
        openPeriodEndsAt: "2026-06-18T11:00:00.000Z",
        openPeriodClosed: true,
        scoreRetrievalEnabled: true,
        status: "suspended",
        scheduledFor: "2026-06-18T09:00:00.000Z",
      },
    });
  });
});
