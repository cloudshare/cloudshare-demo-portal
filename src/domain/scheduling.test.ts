import { describe, expect, it, vi } from "vitest";
import { createInMemoryExamCatalogRepository } from "@/persistence/exam-catalog-repository";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";
import { createInMemoryLabLaunchRepository } from "@/persistence/lab-launch-repository";
import type { CreateDraftExamInput } from "./exam-catalog";
import { createDraftExam, publishExam } from "./exam-catalog";
import { CloudShareProvisioningError, ScheduleValidationError, scheduleExam } from "./scheduling";
import type { CreateTrainingInput, LabProvisioner } from "./lab-launch";

function makeExamInput(overrides: Partial<CreateDraftExamInput> = {}): CreateDraftExamInput {
  return {
    customerId: "customer-helios",
    title: "Helios CloudShare Fundamentals",
    description: "Hands-on certification exam.",
    timeLimitMinutes: 90,
    scoreRetrievalEnabled: false,
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

function makeLabs(order: string[] = []): LabProvisioner {
  return {
    async createExperience() {
      throw new Error("legacy experience flow not used in scheduling tests");
    },
    async addStudent() {
      throw new Error("legacy student flow not used in scheduling tests");
    },
    async createTraining() {
      order.push("createTraining");
      return { trainingId: "training-1" };
    },
    async addParticipant() {
      order.push("addParticipant");
    },
    async createSponsoredLink() {
      order.push("createSponsoredLink");
      return { loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/demo" };
    },
  };
}

async function setup(examOverrides: Partial<CreateDraftExamInput> = {}) {
  const exams = createInMemoryExamCatalogRepository();
  const attempts = createInMemoryExamAttemptRepository();
  const launches = createInMemoryLabLaunchRepository();
  await createDraftExam(
    { repository: exams, now: () => new Date("2026-06-15T09:00:00.000Z"), newId: () => "exam-1" },
    makeExamInput(examOverrides),
  );
  await publishExam(
    { repository: exams, now: () => new Date("2026-06-15T09:05:00.000Z") },
    { customerId: "customer-helios", examId: "exam-1" },
  );

  return { exams, attempts, launches };
}

describe("scheduleExam", () => {
  it("creates a scheduled attempt, provisions training in order, and finalizes the attempt as ready", async () => {
    const { exams, attempts, launches } = await setup();
    const order: string[] = [];
    const addParticipant = vi.fn(async () => {
      order.push("addParticipant");
    });
    const createSponsoredLink = vi.fn(async () => {
      order.push("createSponsoredLink");
      return { loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/demo" };
    });

    const result = await scheduleExam(
      {
        exams,
        attempts,
        launches,
        labs: {
          ...makeLabs(order),
          addParticipant,
          createSponsoredLink,
        },
        newId: vi
          .fn()
          .mockReturnValueOnce("attempt-1")
          .mockReturnValueOnce("launch-1"),
        now: () => new Date("2026-06-15T10:00:00.000Z"),
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-1",
        scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      },
    );

    expect(order).toEqual(["createTraining", "addParticipant", "createSponsoredLink"]);
    expect(addParticipant).toHaveBeenCalledWith({
      trainingId: "training-1",
      email: "candidate@helioscx.demo",
      firstName: "Asha",
      lastName: "Patel",
    });
    expect(createSponsoredLink).toHaveBeenCalledWith({
      trainingId: "training-1",
      email: "candidate@helioscx.demo",
      firstName: "Asha",
      lastName: "Patel",
    });
    expect(result).toEqual({
      attempt: {
        id: "attempt-1",
        examId: "exam-1",
        scheduledFor: "2026-06-15T16:00:00.000Z",
        status: "ready",
      },
      coldStartLikely: false,
    });

    await expect(attempts.findById("attempt-1")).resolves.toMatchObject({
      id: "attempt-1",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
    });
    await expect(launches.findByExamAttemptId("attempt-1")).resolves.toMatchObject({
      id: "launch-1",
      trainingId: "training-1",
      examAttemptId: "attempt-1",
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/demo",
    });
  });

  it("uses a deterministic unique CloudShare training name", async () => {
    const { exams, attempts, launches } = await setup();
    const createTraining = vi.fn(async (_input: CreateTrainingInput) => ({ trainingId: "training-1" }));

    await scheduleExam(
      {
        exams,
        attempts,
        launches,
        labs: {
          ...makeLabs(),
          createTraining,
        },
        newId: vi
          .fn()
          .mockReturnValueOnce("attempt-1")
          .mockReturnValueOnce("launch-1"),
        now: () => new Date("2026-06-15T10:12:30.000Z"),
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-1",
        scheduledFor: new Date("2026-06-20T16:00:00.000Z"),
      },
    );

    expect(createTraining).toHaveBeenCalledWith(
      expect.objectContaining({
        title:
          "Helios Exam Blueprint - Asha Patel - candidate@helioscx.demo - 20260620T160000Z - 20260615T101230Z",
      }),
    );
  });

  it("keeps the CloudShare training name within the live 100-character limit", async () => {
    const { exams, attempts, launches } = await setup({
      blueprintName: "Very Long Helios Certification Blueprint Used For Advanced Customer Simulation Exams",
    });
    const createTraining = vi.fn(async (_input: CreateTrainingInput) => ({ trainingId: "training-1" }));

    await scheduleExam(
      {
        exams,
        attempts,
        launches,
        labs: {
          ...makeLabs(),
          createTraining,
        },
        newId: vi
          .fn()
          .mockReturnValueOnce("attempt-1")
          .mockReturnValueOnce("launch-1"),
        now: () => new Date("2026-06-15T10:12:30.000Z"),
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate.with.a.long.address@certification-demo.helioscx.example",
        candidateFirstName: "Alexandria",
        candidateLastName: "Montgomery-Cunningham",
        examId: "exam-1",
        scheduledFor: new Date("2026-06-20T16:00:00.000Z"),
      },
    );

    const title = createTraining.mock.calls[0]![0].title;
    expect(title.length).toBeLessThanOrEqual(100);
    expect(title).toContain("20260620T160000Z");
    expect(title).toContain("20260615T101230Z");
  });

  it("flags a likely cold start when scheduled within five hours", async () => {
    const { exams, attempts, launches } = await setup();

    const result = await scheduleExam(
      {
        exams,
        attempts,
        launches,
        labs: makeLabs(),
        newId: vi
          .fn()
          .mockReturnValueOnce("attempt-1")
          .mockReturnValueOnce("launch-1"),
        now: () => new Date("2026-06-15T10:00:00.000Z"),
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-1",
        scheduledFor: new Date("2026-06-15T12:30:00.000Z"),
      },
    );

    expect(result.coldStartLikely).toBe(true);
  });

  it("does not persist a candidate-visible attempt or lab launch when CloudShare provisioning fails", async () => {
    const { exams, attempts, launches } = await setup();
    const order: string[] = [];
    const sponsoredLink = vi.fn();

    await expect(
      scheduleExam(
        {
          exams,
          attempts,
          launches,
          labs: {
            async createExperience() {
              throw new Error("legacy experience flow not used in scheduling tests");
            },
            async addStudent() {
              throw new Error("legacy student flow not used in scheduling tests");
            },
            async createTraining() {
              order.push("createTraining");
              return { trainingId: "training-1" };
            },
            async addParticipant() {
              order.push("addParticipant");
              throw new Error("forbidden");
            },
            createSponsoredLink: sponsoredLink,
          },
          newId: vi
            .fn()
            .mockReturnValueOnce("attempt-1")
            .mockReturnValueOnce("launch-1"),
          now: () => new Date("2026-06-15T10:00:00.000Z"),
        },
        {
          customerId: "customer-helios",
          candidateId: "candidate-1",
          candidateEmail: "candidate@helioscx.demo",
          candidateFirstName: "Asha",
          candidateLastName: "Patel",
          examId: "exam-1",
          scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
        },
      ),
    ).rejects.toBeInstanceOf(CloudShareProvisioningError);

    expect(order).toEqual(["createTraining", "addParticipant"]);
    expect(sponsoredLink).not.toHaveBeenCalled();
    await expect(attempts.findById("attempt-1")).resolves.toBeNull();
    await expect(launches.findByExamAttemptId("attempt-1")).resolves.toBeNull();
  });

  it("rejects non-future schedule times", async () => {
    const { exams, attempts, launches } = await setup();

    await expect(
      scheduleExam(
        {
          exams,
          attempts,
          launches,
          labs: makeLabs(),
          newId: vi.fn(),
          now: () => new Date("2026-06-15T10:00:00.000Z"),
        },
        {
          customerId: "customer-helios",
          candidateId: "candidate-1",
          candidateEmail: "candidate@helioscx.demo",
          candidateFirstName: "Asha",
          candidateLastName: "Patel",
          examId: "exam-1",
          scheduledFor: new Date("2026-06-15T10:00:00.000Z"),
        },
      ),
    ).rejects.toBeInstanceOf(ScheduleValidationError);
  });
});
