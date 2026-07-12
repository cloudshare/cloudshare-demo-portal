import { describe, expect, it } from "vitest";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";
import { createInMemoryLabLaunchRepository } from "@/persistence/lab-launch-repository";
import {
  CandidateAdmissionConflictError,
  CandidateAdmissionConnectionError,
  CandidateAdmissionIdentityError,
  CandidateAdmissionRetakeError,
  completeCandidateAdmission,
  recoverCandidateAdmissionAttempt,
  reserveCandidateAdmissionAttempt,
  requireCandidateAdmissionIdentity,
  requireCandidateAdmissionConnection,
} from "./candidate-admission";

describe("Candidate admission", () => {
  it("normalizes a Candidate identity once for either delivery mode", () => {
    expect(
      requireCandidateAdmissionIdentity({ firstName: "  Asha ", lastName: " Patel  " }),
    ).toEqual({ firstName: "Asha", lastName: "Patel" });

    expect(() => requireCandidateAdmissionIdentity({ firstName: "A", lastName: "Patel" })).toThrow(
      CandidateAdmissionIdentityError,
    );
  });

  it("requires a Customer-scoped CloudShare Connection before either delivery can provision", async () => {
    await expect(
      requireCandidateAdmissionConnection(
        { findByCustomerId: async () => null } as never,
        "customer-helios",
      ),
    ).rejects.toMatchObject({ name: CandidateAdmissionConnectionError.name, customerId: "customer-helios" });

    const persistenceFailure = new Error("connection repository unavailable");
    await expect(
      requireCandidateAdmissionConnection(
        { findByCustomerId: async () => Promise.reject(persistenceFailure) } as never,
        "customer-helios",
      ),
    ).rejects.toBe(persistenceFailure);
  });

  it("reserves a provisional ExamAttempt only when the Candidate has no overlapping availability", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    await attempts.save({
      id: "attempt-existing",
      customerId: "customer-helios",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-07-12T10:00:00.000Z"),
      createdAt: new Date("2026-07-12T09:00:00.000Z"),
    });

    await expect(
      reserveCandidateAdmissionAttempt(
        { attempts },
        {
          attemptId: "attempt-new",
          customerId: "customer-helios",
          candidateId: "candidate-1",
          examId: "exam-1",
          scheduledFor: new Date("2026-07-12T10:30:00.000Z"),
          createdAt: new Date("2026-07-12T09:30:00.000Z"),
          availabilityWindowMinutes: 90,
        },
      ),
    ).rejects.toMatchObject({
      name: CandidateAdmissionConflictError.name,
      conflictingAttemptId: "attempt-existing",
      nextAvailableAt: new Date("2026-07-12T11:30:00.000Z"),
    });

    await expect(attempts.findById("attempt-new")).resolves.toBeNull();
  });

  it("keeps the Cohort Exam Session no-retake rule distinct from same-Exam availability", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    await attempts.save({
      id: "attempt-completed",
      customerId: "customer-helios",
      candidateId: "candidate-1",
      examId: "exam-1",
      cohortSessionId: "cohort-1",
      status: "completed",
      scheduledFor: new Date("2026-07-12T08:00:00.000Z"),
      createdAt: new Date("2026-07-12T07:00:00.000Z"),
    });

    await expect(
      reserveCandidateAdmissionAttempt(
        { attempts },
        {
          attemptId: "attempt-new",
          customerId: "customer-helios",
          candidateId: "candidate-1",
          examId: "exam-1",
          cohortSessionId: "cohort-1",
          scheduledFor: new Date("2026-07-12T12:00:00.000Z"),
          createdAt: new Date("2026-07-12T12:00:00.000Z"),
          availabilityWindowMinutes: 90,
        },
      ),
    ).rejects.toMatchObject({ name: CandidateAdmissionRetakeError.name, cohortSessionId: "cohort-1" });
  });

  it("finalizes the provisional ExamAttempt and removes it when portal recovery is required", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const attempt = await reserveCandidateAdmissionAttempt(
      { attempts },
      {
        attemptId: "attempt-1",
        customerId: "customer-helios",
        candidateId: "candidate-1",
        examId: "exam-1",
        scheduledFor: new Date("2026-07-12T12:00:00.000Z"),
        createdAt: new Date("2026-07-12T12:00:00.000Z"),
        availabilityWindowMinutes: 90,
      },
    );

    const completed = await completeCandidateAdmission(
      { attempts, launches },
      {
        attempt,
        launch: {
          id: "launch-1",
          candidateId: "candidate-1",
          participantEmail: "candidate@helioscx.demo",
          trainingId: "training-1",
          experienceId: "experience-1",
          loginUrl: "https://cloudshare.example/sponsored-link",
          status: "launched",
          createdAt: new Date("2026-07-12T12:00:00.000Z"),
        },
      },
    );

    expect(completed.attempt.status).toBe("ready");
    await expect(launches.findByExamAttemptId("attempt-1")).resolves.toMatchObject({
      trainingId: "training-1",
      loginUrl: "https://cloudshare.example/sponsored-link",
    });

    await recoverCandidateAdmissionAttempt({ attempts }, completed.attempt.id);
    await expect(attempts.findById("attempt-1")).resolves.toBeNull();
  });

  it("recovers the provisional ExamAttempt when LabLaunch persistence fails", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const attempt = await reserveCandidateAdmissionAttempt(
      { attempts },
      {
        attemptId: "attempt-1",
        customerId: "customer-helios",
        candidateId: "candidate-1",
        examId: "exam-1",
        scheduledFor: new Date("2026-07-12T12:00:00.000Z"),
        createdAt: new Date("2026-07-12T12:00:00.000Z"),
        availabilityWindowMinutes: 90,
      },
    );

    await expect(
      completeCandidateAdmission(
        {
          attempts,
          launches: { ...launches, save: async () => Promise.reject(new Error("LabLaunch store unavailable")) },
        },
        {
          attempt,
          launch: {
            id: "launch-1",
            candidateId: "candidate-1",
            experienceId: "experience-1",
            loginUrl: "https://cloudshare.example/sponsored-link",
            status: "launched",
            createdAt: new Date("2026-07-12T12:00:00.000Z"),
          },
        },
      ),
    ).rejects.toThrow("LabLaunch store unavailable");

    await expect(attempts.findById("attempt-1")).resolves.toBeNull();
  });
});
