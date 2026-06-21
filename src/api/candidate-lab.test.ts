import { describe, expect, it, vi } from "vitest";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";
import { createInMemoryExamCatalogRepository } from "@/persistence/exam-catalog-repository";
import { createExamClock, createInMemoryExamClockRepository } from "@/domain/exam-clock";
import { createDraftExam, publishExam } from "@/domain/exam-catalog";
import { handleGetCandidateLabStatus } from "./candidate-lab";

describe("candidate lab status handler", () => {
  it("surfaces a completed exam attempt once clock reconciliation consumes the runtime", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const exams = createInMemoryExamCatalogRepository();
    const clockRepository = createInMemoryExamClockRepository();
    let nowMs = new Date("2026-06-18T10:00:30.000Z").getTime();
    const clocks = createExamClock({
      clocks: clockRepository,
      now: () => new Date(nowMs),
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

    const response = await handleGetCandidateLabStatus(
      {
        attempts,
        exams,
        clocks,
        logger: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      },
      {
        examAttemptId: "attempt-1",
        candidateId: "candidate-1",
      },
    );

    expect(response).toEqual({
      status: 200,
      body: {
        examAttemptId: "attempt-1",
        examTitle: "Helios Guided Journey",
        timeLimitMinutes: 60,
        status: "completed",
        scheduledFor: "2026-06-18T09:00:00.000Z",
      },
    });
  });

  it("does not reconcile or mutate another candidate's attempt when the examAttemptId is guessed", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const exams = createInMemoryExamCatalogRepository();
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
      candidateId: "candidate-owner",
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

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const response = await handleGetCandidateLabStatus(
      {
        attempts,
        exams,
        clocks,
        logger,
      },
      {
        examAttemptId: "attempt-1",
        candidateId: "candidate-attacker",
      },
    );

    expect(response).toEqual({
      status: 403,
      body: { error: "forbidden" },
    });
    await expect(attempts.findById("attempt-1")).resolves.toMatchObject({
      status: "in_progress",
    });
    await expect(clockRepository.findByExamAttemptId("attempt-1")).resolves.toMatchObject({
      status: "running",
      elapsedAtPauseMs: 59 * 60 * 1000,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "candidate requested another candidate's lab status",
      expect.objectContaining({
        examAttemptId: "attempt-1",
        candidateId: "candidate-attacker",
        ownerCandidateId: "candidate-owner",
        customerId: "customer-1",
        examId: "exam-1",
      }),
    );
  });
});
