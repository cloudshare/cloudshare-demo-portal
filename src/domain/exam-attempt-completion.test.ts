import { describe, expect, it } from "vitest";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";
import { createInMemoryExamCatalogRepository } from "@/persistence/exam-catalog-repository";
import { createExamClock, createInMemoryExamClockRepository } from "./exam-clock";
import { createDraftExam, publishExam } from "./exam-catalog";
import { reconcileExamAttemptCompletion } from "./exam-attempt-completion";

describe("reconcileExamAttemptCompletion", () => {
  it("completes an in-progress exam attempt once the portal-owned runtime reaches the exam time limit", async () => {
    const exams = createInMemoryExamCatalogRepository();
    const attempts = createInMemoryExamAttemptRepository();
    const clockRepository = createInMemoryExamClockRepository();
    let nowMs = new Date("2026-06-18T10:00:00.000Z").getTime();
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
        title: "Guided Journey Exam",
        description: "Exam with score retrieval.",
        timeLimitMinutes: 60,
        openPeriodMinutes: 120,
        scoreRetrievalEnabled: true,
        projectId: "project-1",
        projectName: "Helios CX",
        blueprintId: "bp-1",
        blueprintName: "Guided Journey Blueprint",
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
      startedAt: new Date("2026-06-18T09:59:00.000Z"),
      updatedAt: new Date("2026-06-18T09:59:00.000Z"),
    });

    const result = await reconcileExamAttemptCompletion(
      {
        attempts,
        exams,
        clocks,
      },
      { examAttemptId: "attempt-1" },
    );

    expect(result).toMatchObject({
      examAttemptId: "attempt-1",
      status: "completed",
      changed: true,
      elapsedMs: 60 * 60 * 1000,
    });
    await expect(attempts.findById("attempt-1")).resolves.toMatchObject({
      status: "completed",
    });
    await expect(clockRepository.findByExamAttemptId("attempt-1")).resolves.toMatchObject({
      status: "paused",
      elapsedAtPauseMs: 60 * 60 * 1000,
      startedAt: null,
    });
  });

  it("is idempotent for an already completed and settled attempt", async () => {
    const exams = createInMemoryExamCatalogRepository();
    const attempts = createInMemoryExamAttemptRepository();
    const clockRepository = createInMemoryExamClockRepository();
    const clocks = createExamClock({
      clocks: clockRepository,
      now: () => new Date("2026-06-18T10:00:00.000Z"),
    });

    await createDraftExam(
      {
        repository: exams,
        now: () => new Date("2026-06-18T08:00:00.000Z"),
        newId: () => "exam-1",
      },
      {
        customerId: "customer-1",
        title: "Guided Journey Exam",
        description: "Exam with score retrieval.",
        timeLimitMinutes: 60,
        openPeriodMinutes: 120,
        scoreRetrievalEnabled: true,
        projectId: "project-1",
        projectName: "Helios CX",
        blueprintId: "bp-1",
        blueprintName: "Guided Journey Blueprint",
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
      status: "completed",
      scheduledFor: new Date("2026-06-18T09:00:00.000Z"),
      createdAt: new Date("2026-06-18T08:55:00.000Z"),
    });
    await clockRepository.save({
      examAttemptId: "attempt-1",
      status: "paused",
      elapsedAtPauseMs: 60 * 60 * 1000,
      startedAt: null,
      updatedAt: new Date("2026-06-18T10:00:00.000Z"),
    });

    const result = await reconcileExamAttemptCompletion(
      {
        attempts,
        exams,
        clocks,
      },
      { examAttemptId: "attempt-1" },
    );

    expect(result).toMatchObject({
      examAttemptId: "attempt-1",
      status: "completed",
      changed: false,
      elapsedMs: 60 * 60 * 1000,
    });
  });
});
