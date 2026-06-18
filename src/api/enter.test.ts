import { describe, expect, it, vi } from "vitest";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";
import { createInMemoryLabLaunchRepository } from "@/persistence/lab-launch-repository";
import type { Logger } from "@/observability/logger";
import { handleEnterExam } from "./enter";
import type { ExamTimer } from "@/domain/timer-sync";
import { createExamClock, createInMemoryExamClockRepository } from "@/domain/exam-clock";
import { createInMemoryExamCatalogRepository } from "@/persistence/exam-catalog-repository";
import { createDraftExam, publishExam } from "@/domain/exam-catalog";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeTimer(): ExamTimer & { resumed: string[] } {
  const resumed: string[] = [];
  return {
    resumed,
    pauseTimer: vi.fn().mockResolvedValue(undefined),
    resumeTimer: vi.fn(async (examAttemptId: string) => {
      resumed.push(examAttemptId);
    }),
  };
}

describe("handleEnterExam", () => {
  async function seedExam(exams = createInMemoryExamCatalogRepository()) {
    await createDraftExam(
      {
        repository: exams,
        now: () => new Date("2026-06-15T09:00:00.000Z"),
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
      { repository: exams, now: () => new Date("2026-06-15T09:05:00.000Z") },
      { customerId: "customer-1", examId: "exam-1" },
    );
    return exams;
  }

  it("refuses entry before the scheduled time without leaking the sponsored loginUrl", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();

    await attempts.save({
      id: "attempt-1",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await launches.save({
      id: "launch-1",
      examAttemptId: "attempt-1",
      candidateId: "candidate-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "training-1",
      experienceId: "training-1",
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
      status: "launched",
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    const response = await handleEnterExam(
      {
        attempts,
        launches,
        logger: makeLogger(),
        now: () => new Date("2026-06-15T15:59:59.000Z"),
      },
      { examAttemptId: "attempt-1", candidateId: "candidate-1" },
    );

    expect(response.status).toBe(403);
    expect(response.body).toEqual("Exam entry is not available before the scheduled start time.");
    expect(JSON.stringify(response)).not.toContain("loginUrl");
    expect(response.headers.location).toBeUndefined();
  });

  it("redirects to the sponsored link within the launch window", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const timer = makeTimer();

    await attempts.save({
      id: "attempt-1",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await launches.save({
      id: "launch-1",
      examAttemptId: "attempt-1",
      candidateId: "candidate-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "training-1",
      experienceId: "training-1",
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
      status: "launched",
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    const response = await handleEnterExam(
      {
        attempts,
        launches,
        timer,
        logger: makeLogger(),
        now: () => new Date("2026-06-15T16:00:00.000Z"),
      },
      { examAttemptId: "attempt-1", candidateId: "candidate-1" },
    );

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(
      "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
    );
    expect(response.body).toBe("Redirecting to the CloudShare lab.");
    expect(timer.resumed).toEqual(["attempt-1"]);
    await expect(attempts.findById("attempt-1")).resolves.toMatchObject({
      status: "in_progress",
    });
  });

  it("recomputes ownership server-side and denies another candidate", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();

    await attempts.save({
      id: "attempt-1",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await launches.save({
      id: "launch-1",
      examAttemptId: "attempt-1",
      candidateId: "candidate-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "training-1",
      experienceId: "training-1",
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
      status: "launched",
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    const response = await handleEnterExam(
      {
        attempts,
        launches,
        logger: makeLogger(),
        now: () => new Date("2026-06-15T16:00:00.000Z"),
      },
      { examAttemptId: "attempt-1", candidateId: "candidate-2" },
    );

    expect(response.status).toBe(403);
    expect(response.body).toBe("Exam entry is not allowed for this candidate.");
    expect(JSON.stringify(response)).not.toContain("secret");
  });

  it("reconciles runtime exhaustion before redirect and completes the attempt instead of entering", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const exams = await seedExam();
    const clockRepository = createInMemoryExamClockRepository();
    const timer = makeTimer();
    const clocks = createExamClock({
      clocks: clockRepository,
      now: () => new Date("2026-06-15T16:00:30.000Z"),
    });

    await attempts.save({
      id: "attempt-1",
      customerId: "customer-1",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await clockRepository.save({
      examAttemptId: "attempt-1",
      status: "running",
      elapsedAtPauseMs: 59 * 60 * 1000,
      startedAt: new Date("2026-06-15T15:59:30.000Z"),
      updatedAt: new Date("2026-06-15T15:59:30.000Z"),
    });
    await launches.save({
      id: "launch-1",
      examAttemptId: "attempt-1",
      candidateId: "candidate-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "training-1",
      experienceId: "training-1",
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
      status: "launched",
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    const response = await handleEnterExam(
      {
        attempts,
        launches,
        exams,
        clocks,
        timer,
        logger: makeLogger(),
        now: () => new Date("2026-06-15T16:00:30.000Z"),
      },
      { examAttemptId: "attempt-1", candidateId: "candidate-1" },
    );

    expect(response.status).toBe(403);
    expect(response.body).toBe("Exam entry is not available for this attempt.");
    expect(response.headers.location).toBeUndefined();
    expect(timer.resumed).toEqual([]);
    await expect(attempts.findById("attempt-1")).resolves.toMatchObject({
      status: "completed",
    });
  });
});
