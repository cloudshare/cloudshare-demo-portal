import { describe, expect, it, vi } from "vitest";
import { createInMemoryLabLaunchRepository } from "@/persistence/lab-launch-repository";
import { correlateEnvironmentForExamAttempt } from "./environment-correlation";

describe("correlateEnvironmentForExamAttempt", () => {
  it("records the discovered training participant environment ID for both correlation fields", async () => {
    const launches = createInMemoryLabLaunchRepository();
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

    const result = await correlateEnvironmentForExamAttempt(
      {
        launches,
        participants: {
          listParticipants: vi.fn().mockResolvedValue([
            {
              email: "candidate@helioscx.demo",
              environmentId: "env-1",
              environmentStatus: "ready",
              studentId: "student-1",
            },
          ]),
        },
      },
      { examAttemptId: "attempt-1" },
    );

    expect(result).toEqual({
      examAttemptId: "attempt-1",
      trainingId: "training-1",
      environmentId: "env-1",
      correlated: true,
    });
    await expect(launches.findByExamAttemptId("attempt-1")).resolves.toMatchObject({
      environmentId: "env-1",
      environmentExternalId: "env-1",
      participantId: "student-1",
    });
  });

  it("matches participant email case-insensitively", async () => {
    const launches = createInMemoryLabLaunchRepository();
    await launches.save({
      id: "launch-1",
      examAttemptId: "attempt-1",
      candidateId: "candidate-1",
      participantEmail: "Candidate@HeliosCX.demo",
      trainingId: "training-1",
      experienceId: "training-1",
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
      status: "launched",
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    const result = await correlateEnvironmentForExamAttempt(
      {
        launches,
        participants: {
          listParticipants: vi.fn().mockResolvedValue([
            {
              email: "candidate@helioscx.demo",
              environmentId: "env-1",
              environmentStatus: "ready",
            },
          ]),
        },
      },
      { examAttemptId: "attempt-1" },
    );

    expect(result.correlated).toBe(true);
    expect(result.environmentId).toBe("env-1");
  });

  it("leaves the mapping untouched when CloudShare has not exposed an environmentId yet", async () => {
    const launches = createInMemoryLabLaunchRepository();
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

    const result = await correlateEnvironmentForExamAttempt(
      {
        launches,
        participants: {
          listParticipants: vi.fn().mockResolvedValue([
            {
              email: "candidate@helioscx.demo",
              environmentId: null,
              environmentStatus: null,
            },
          ]),
        },
      },
      { examAttemptId: "attempt-1" },
    );

    expect(result).toEqual({
      examAttemptId: "attempt-1",
      trainingId: "training-1",
      environmentId: null,
      correlated: false,
    });
    const launch = await launches.findByExamAttemptId("attempt-1");
    expect(launch).not.toHaveProperty("environmentId");
  });

  it("ignores a pending placeholder envId until CloudShare reports an active environment, then updates to the actionable envId", async () => {
    const launches = createInMemoryLabLaunchRepository();
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

    const listParticipants = vi
      .fn()
      .mockResolvedValueOnce([
        {
          email: "candidate@helioscx.demo",
          environmentId: "ENKolD1-ab84YIxODeMGob9A2",
          environmentStatus: null,
          participationStatus: "pending",
        },
      ])
      .mockResolvedValueOnce([
        {
          email: "candidate@helioscx.demo",
          environmentId: "ENVS2n38LTNdcC4sHsqnjRzg2",
          environmentStatus: "ready",
          participationStatus: "inProgress",
        },
      ]);

    await expect(
      correlateEnvironmentForExamAttempt(
        {
          launches,
          participants: { listParticipants },
        },
        { examAttemptId: "attempt-1" },
      ),
    ).resolves.toEqual({
      examAttemptId: "attempt-1",
      trainingId: "training-1",
      environmentId: null,
      correlated: false,
    });
    await expect(launches.findByExamAttemptId("attempt-1")).resolves.not.toMatchObject({
      environmentId: "ENKolD1-ab84YIxODeMGob9A2",
      environmentExternalId: "ENKolD1-ab84YIxODeMGob9A2",
    });

    await expect(
      correlateEnvironmentForExamAttempt(
        {
          launches,
          participants: { listParticipants },
        },
        { examAttemptId: "attempt-1" },
      ),
    ).resolves.toEqual({
      examAttemptId: "attempt-1",
      trainingId: "training-1",
      environmentId: "ENVS2n38LTNdcC4sHsqnjRzg2",
      correlated: true,
    });
    await expect(launches.findByExamAttemptId("attempt-1")).resolves.toMatchObject({
      environmentId: "ENVS2n38LTNdcC4sHsqnjRzg2",
      environmentExternalId: "ENVS2n38LTNdcC4sHsqnjRzg2",
    });
  });
});
