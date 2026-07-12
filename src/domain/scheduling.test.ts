import { describe, expect, it, vi } from "vitest";
import { createInMemoryExamCatalogRepository } from "@/persistence/exam-catalog-repository";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";
import { createInMemoryLabLaunchRepository } from "@/persistence/lab-launch-repository";
import {
  SameExamAttemptAvailabilityConflictError,
  type ExamAttemptRepository,
} from "./exam-attempt";
import type { CreateDraftExamInput } from "./exam-catalog";
import { createDraftExam, publishExam } from "./exam-catalog";
import {
  CloudShareProvisioningError,
  ScheduleExamNotFoundError,
  ScheduleValidationError,
  scheduleExam,
} from "./scheduling";
import {
  TrainingDeliveryOperationError,
  type CreateTrainingInput,
  type IndividualTrainingDelivery,
  type LabProvisioner,
} from "./lab-launch";
import { createDiagnosticRecorder } from "./diagnostic-log";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";

const SPONSORED_LINK_URL =
  "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret-token";

function makeExamInput(overrides: Partial<CreateDraftExamInput> = {}): CreateDraftExamInput {
  return {
    customerId: "customer-helios",
    title: "Helios CloudShare Fundamentals",
    description: "Hands-on certification exam.",
    timeLimitMinutes: 90,
    storageLeaseMinutes: 90,
    openPeriodMinutes: 90,
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

it("uses the authored open period for CloudShare training End while preserving the runtime Exam timer", async () => {
  const exams = createInMemoryExamCatalogRepository();
  await createDraftExam(
    { repository: exams, now: () => new Date("2026-06-15T09:00:00.000Z"), newId: () => "exam-1" },
    makeExamInput({ timeLimitMinutes: 10, storageLeaseMinutes: 2880, openPeriodMinutes: 60 }),
  );
  await publishExam(
    { repository: exams, now: () => new Date("2026-06-15T09:05:00.000Z") },
    { customerId: "customer-helios", examId: "exam-1" },
  );
  const createTraining = vi.fn(async (input: CreateTrainingInput) => ({
    trainingId: "training-1",
    request: {
      method: "POST",
      path: "/trainings",
      body: {
        Start: input.scheduledFor.toISOString(),
        End: input.endsAt.toISOString(),
      },
    },
    response: { status: 200, body: { id: "training-1" } },
  }));

  await scheduleExam(
    {
      exams,
      attempts: createInMemoryExamAttemptRepository(),
      launches: createInMemoryLabLaunchRepository(),
      trainingDelivery: testTrainingDelivery({
        ...makeLabs(),
        createTraining,
      }),
      newId: vi.fn().mockReturnValueOnce("attempt-1").mockReturnValueOnce("launch-1"),
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

  expect(createTraining).toHaveBeenCalledWith(
    expect.objectContaining({
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      endsAt: new Date("2026-06-15T17:00:00.000Z"),
    }),
  );
  await expect(exams.findById("exam-1")).resolves.toMatchObject({
    timeLimitMinutes: 10,
    storageLeaseMinutes: 2880,
    openPeriodMinutes: 60,
  });
});

function makeLabs(order: string[] = []): LabProvisioner & IndividualTrainingDelivery {
  return {
    async createExperience() {
      throw new Error("legacy experience flow not used in scheduling tests");
    },
    async addStudent() {
      throw new Error("legacy student flow not used in scheduling tests");
    },
    async createTraining() {
      order.push("createTraining");
      return {
        trainingId: "training-1",
        teamId: "team-1",
        teamCount: 1,
        integrationSurface: "cloudshare.v4.training",
        request: {
          method: "POST",
          path: "/trainings",
          body: {
            Name: "Helios Exam Blueprint - Asha Patel - candidate@helioscx.demo - 20260615T160000Z - 20260615T100000Z",
            Start: "2026-06-15T16:00:00.000Z",
            End: "2026-06-15T17:30:00.000Z",
            Type: "instructorLed",
            ProjectId: "project-1",
            TeamId: "team-1",
            BlueprintIds: ["bp-1"],
            PolicyId: "policy-1",
            CloudshareRegionIds: ["region-1"],
            MainInstructor: { Email: "instructor-1" },
            TimeZone: "UTC",
            Passphrase: "certalis-attempt-1",
            ExternalId: "attempt1",
            UsersEarlyAccess: { GrantEarlyAccess: 2 },
          },
        },
        response: {
          status: 200,
          body: { id: "training-1" },
        },
      };
    },
    async ensureTrainingUserPropertyKeys() {
      order.push("ensureUserProperties");
      return {
        trainingId: "training-1",
        experienceId: "training-1",
        requiredKeys: ["certalisExamAttemptId", "certalisCandidateId"],
        availableKeys: ["certalisExamAttemptId", "certalisCandidateId"],
        definitions: [
          { id: "certalisExamAttemptId", name: "certalisExamAttemptId" },
          { id: "certalisCandidateId", name: "certalisCandidateId" },
        ],
        integrationSurface: "cloudshare.v4.training.user_properties",
        request: { method: "GET", path: "/trainings/training-1/users/properties" },
        response: { status: 200, body: [] },
      };
    },
    async addParticipant() {
      order.push("addParticipant");
      return {
        integrationSurface: "cloudshare.v4.training.participant",
        request: {
          method: "POST",
          path: "/trainings/training-1/students",
          body: [
            {
              email: "candidate@helioscx.demo",
              firstName: "Candidate",
              lastName: "Demo",
            },
          ],
        },
        response: {
          status: 200,
          body: [{ email: "candidate@helioscx.demo", firstName: "Candidate", lastName: "Demo" }],
        },
      };
    },
    async createSponsoredLink() {
      order.push("createSponsoredLink");
      return {
        loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/demo",
        integrationSurface: "cloudshare.v4.training.sponsored_link",
        request: {
          method: "POST",
          path: "/trainings/training-1/sponsored-link",
          body: {
            email: "candidate@helioscx.demo",
            firstName: "Candidate",
            lastName: "Demo",
          },
        },
        response: {
          status: 200,
          body: { loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/demo" },
        },
      };
    },
    async provisionIndividual(input) {
      let training;
      try {
        training = await this.createTraining!(input.training);
      } catch (cause) {
        throw new TrainingDeliveryOperationError("create_training", { cause });
      }
      let userProperties;
      try {
        userProperties = await this.ensureTrainingUserPropertyKeys!({
          trainingId: training.trainingId,
          experienceId: training.trainingId,
          requiredKeys: ["certalisExamAttemptId", "certalisCandidateId"],
        });
      } catch (cause) {
        throw new TrainingDeliveryOperationError("ensure_user_properties", {
          cause,
          trainingId: training.trainingId,
          individual: { training },
        });
      }
      let participant;
      try {
        participant = await this.addParticipant!({
          ...input.participant,
          trainingId: training.trainingId,
        });
      } catch (cause) {
        throw new TrainingDeliveryOperationError("add_participant", {
          cause,
          trainingId: training.trainingId,
          individual: { training, userProperties },
        });
      }
      try {
        const sponsoredLink = await this.createSponsoredLink!({
          trainingId: training.trainingId,
          email: input.participant.email,
          firstName: input.participant.firstName,
          lastName: input.participant.lastName,
        });
        return { training, userProperties, participant, sponsoredLink };
      } catch (cause) {
        throw new TrainingDeliveryOperationError("create_sponsored_link", {
          cause,
          trainingId: training.trainingId,
          individual: { training, userProperties, participant },
        });
      }
    },
  };
}

function testTrainingDelivery<T extends IndividualTrainingDelivery>(delivery: T): IndividualTrainingDelivery {
  return delivery;
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

async function addPublishedExam(
  exams: ReturnType<typeof createInMemoryExamCatalogRepository>,
  examId: string,
  overrides: Partial<CreateDraftExamInput> = {},
) {
  await createDraftExam(
    { repository: exams, now: () => new Date("2026-06-15T09:10:00.000Z"), newId: () => examId },
    makeExamInput({ title: `Exam ${examId}`, ...overrides }),
  );
  await publishExam(
    { repository: exams, now: () => new Date("2026-06-15T09:15:00.000Z") },
    { customerId: "customer-helios", examId },
  );
}

describe("scheduleExam", () => {
  it("rejects cohort-only Exams before creating an individual ExamAttempt or lab", async () => {
    const { exams, attempts, launches } = await setup({ deliveryAvailability: "cohort" });
    const createTraining = vi.fn();

    await expect(
      scheduleExam(
        {
          exams,
          attempts,
          launches,
          trainingDelivery: testTrainingDelivery({
            ...makeLabs(),
            createTraining,
          }),
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
          scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
        },
      ),
    ).rejects.toBeInstanceOf(ScheduleExamNotFoundError);

    expect(createTraining).not.toHaveBeenCalled();
    await expect(attempts.listByCandidate("candidate-1")).resolves.toEqual([]);
    await expect(launches.findByExamAttemptId("attempt-1")).resolves.toBeNull();
  });

  it("creates a scheduled attempt, provisions training in order, and finalizes the attempt as ready", async () => {
    const { exams, attempts, launches } = await setup();
    const order: string[] = [];
    const addParticipant = vi.fn(async () => {
      order.push("addParticipant");
      return {
        response: {
          status: 200,
          body: [{ email: "candidate@helioscx.demo", firstName: "Candidate", lastName: "Demo" }],
        },
      };
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
        trainingDelivery: testTrainingDelivery({
          ...makeLabs(order),
          addParticipant,
          createSponsoredLink,
        }),
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

    expect(order).toEqual(["createTraining", "ensureUserProperties", "addParticipant", "createSponsoredLink"]);
    expect(addParticipant).toHaveBeenCalledWith({
      trainingId: "training-1",
      email: "candidate@helioscx.demo",
      firstName: "Asha",
      lastName: "Patel",
      certalisExamAttemptId: "attempt-1",
      certalisCandidateId: "candidate-1",
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
      trainingId: "training-1",
      experienceId: "training-1",
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
        trainingDelivery: testTrainingDelivery({
          ...makeLabs(),
          createTraining,
        }),
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

  it("passes the Exam open period as the CloudShare training end time", async () => {
    const { exams, attempts, launches } = await setup({
      timeLimitMinutes: 90,
      storageLeaseMinutes: 2880,
      openPeriodMinutes: 135,
    });
    const createTraining = vi.fn(async (_input: CreateTrainingInput) => ({ trainingId: "training-1" }));

    await scheduleExam(
      {
        exams,
        attempts,
        launches,
        trainingDelivery: testTrainingDelivery({
          ...makeLabs(),
          createTraining,
        }),
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

    expect(createTraining).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
        endsAt: new Date("2026-06-15T18:15:00.000Z"),
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
        trainingDelivery: testTrainingDelivery({
          ...makeLabs(),
          createTraining,
        }),
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
        trainingDelivery: makeLabs(),
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

  it("blocks a same-Exam schedule inside an existing non-terminal attempt availability window before provisioning", async () => {
    const { exams, attempts, launches } = await setup({
      storageLeaseMinutes: 240,
      openPeriodMinutes: 90,
    });
    await attempts.save({
      id: "attempt-existing",
      customerId: "customer-helios",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    const createTraining = vi.fn();

    await expect(
      scheduleExam(
        {
          exams,
          attempts,
          launches,
          trainingDelivery: testTrainingDelivery({
            ...makeLabs(),
            createTraining,
          }),
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
          scheduledFor: new Date("2026-06-15T17:00:00.000Z"),
        },
      ),
    ).rejects.toMatchObject({
      name: "ScheduleOverlapError",
      nextAvailableAt: new Date("2026-06-15T20:00:00.000Z"),
    });

    expect(createTraining).not.toHaveBeenCalled();
    await expect(attempts.listByCandidate("candidate-1")).resolves.toHaveLength(1);
    await expect(launches.findByExamAttemptId("attempt-existing")).resolves.toBeNull();
  });

  it("blocks a same-Exam schedule whose requested availability window overlaps an existing attempt from before its start", async () => {
    const { exams, attempts, launches } = await setup({
      storageLeaseMinutes: 240,
      openPeriodMinutes: 90,
    });
    await attempts.save({
      id: "attempt-existing",
      customerId: "customer-helios",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    const createTraining = vi.fn();

    await expect(
      scheduleExam(
        {
          exams,
          attempts,
          launches,
          trainingDelivery: testTrainingDelivery({
            ...makeLabs(),
            createTraining,
          }),
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
          scheduledFor: new Date("2026-06-15T15:00:00.000Z"),
        },
      ),
    ).rejects.toMatchObject({
      name: "ScheduleOverlapError",
      nextAvailableAt: new Date("2026-06-15T20:00:00.000Z"),
    });

    expect(createTraining).not.toHaveBeenCalled();
    await expect(attempts.listByCandidate("candidate-1")).resolves.toHaveLength(1);
  });

  it("allows a same-Exam schedule at the end of the existing availability window", async () => {
    const { exams, attempts, launches } = await setup({
      storageLeaseMinutes: 240,
      openPeriodMinutes: 90,
    });
    await attempts.save({
      id: "attempt-existing",
      customerId: "customer-helios",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    const createTraining = vi.fn(makeLabs().createTraining);

    const result = await scheduleExam(
      {
        exams,
        attempts,
        launches,
        trainingDelivery: testTrainingDelivery({
          ...makeLabs(),
          createTraining,
        }),
        newId: vi.fn().mockReturnValueOnce("attempt-2").mockReturnValueOnce("launch-2"),
        now: () => new Date("2026-06-15T10:00:00.000Z"),
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-1",
        scheduledFor: new Date("2026-06-15T20:00:00.000Z"),
      },
    );

    expect(result.attempt.id).toBe("attempt-2");
    expect(createTraining).toHaveBeenCalledOnce();
  });

  it("maps a save-time same-Exam availability conflict to ScheduleOverlapError before provisioning", async () => {
    const { exams, launches } = await setup({
      storageLeaseMinutes: 120,
      openPeriodMinutes: 90,
    });
    const attempts: ExamAttemptRepository = {
      save: vi.fn(),
      saveWithSameExamAvailabilityGuard: vi.fn(async (attempt) => {
        throw new SameExamAttemptAvailabilityConflictError(
          attempt.candidateId,
          attempt.examId,
          "attempt-racing",
          new Date("2026-06-15T18:00:00.000Z"),
        );
      }),
      findById: vi.fn(),
      listByCandidate: vi.fn().mockResolvedValue([]),
      delete: vi.fn(),
    };
    const createTraining = vi.fn();

    await expect(
      scheduleExam(
        {
          exams,
          attempts,
          launches,
          trainingDelivery: testTrainingDelivery({
            ...makeLabs(),
            createTraining,
          }),
          newId: vi.fn().mockReturnValueOnce("attempt-2").mockReturnValueOnce("launch-2"),
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
    ).rejects.toMatchObject({
      name: "ScheduleOverlapError",
      context: {
        conflictingAttemptId: "attempt-racing",
        nextAvailableAt: new Date("2026-06-15T18:00:00.000Z"),
      },
    });

    expect(createTraining).not.toHaveBeenCalled();
  });

  it("allows a different Exam inside another Exam's availability window", async () => {
    const { exams, attempts, launches } = await setup({
      storageLeaseMinutes: 240,
      openPeriodMinutes: 90,
    });
    await addPublishedExam(exams, "exam-2", {
      storageLeaseMinutes: 240,
      openPeriodMinutes: 90,
    });
    await attempts.save({
      id: "attempt-existing",
      customerId: "customer-helios",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    const createTraining = vi.fn(makeLabs().createTraining);

    const result = await scheduleExam(
      {
        exams,
        attempts,
        launches,
        trainingDelivery: testTrainingDelivery({
          ...makeLabs(),
          createTraining,
        }),
        newId: vi.fn().mockReturnValueOnce("attempt-2").mockReturnValueOnce("launch-2"),
        now: () => new Date("2026-06-15T10:00:00.000Z"),
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-2",
        scheduledFor: new Date("2026-06-15T17:00:00.000Z"),
      },
    );

    expect(result.attempt).toMatchObject({ id: "attempt-2", examId: "exam-2" });
    expect(createTraining).toHaveBeenCalledOnce();
  });

  it("ignores terminal same-Exam attempts when checking overlap", async () => {
    const { exams, attempts, launches } = await setup({
      storageLeaseMinutes: 240,
      openPeriodMinutes: 90,
    });
    await attempts.save({
      id: "attempt-completed",
      customerId: "customer-helios",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "completed",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await attempts.save({
      id: "attempt-expired",
      customerId: "customer-helios",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "expired",
      scheduledFor: new Date("2026-06-15T17:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:05:00.000Z"),
    });
    const createTraining = vi.fn(makeLabs().createTraining);

    const result = await scheduleExam(
      {
        exams,
        attempts,
        launches,
        trainingDelivery: testTrainingDelivery({
          ...makeLabs(),
          createTraining,
        }),
        newId: vi.fn().mockReturnValueOnce("attempt-2").mockReturnValueOnce("launch-2"),
        now: () => new Date("2026-06-15T10:00:00.000Z"),
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-1",
        scheduledFor: new Date("2026-06-15T17:30:00.000Z"),
      },
    );

    expect(result.attempt.id).toBe("attempt-2");
    expect(createTraining).toHaveBeenCalledOnce();
  });

  it("uses the Exam open period for overlap checks when storage lease evidence is unknown", async () => {
    const { exams, attempts, launches } = await setup({
      storageLeaseMinutes: null,
      openPeriodMinutes: 90,
    });
    await attempts.save({
      id: "attempt-existing",
      customerId: "customer-helios",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    const createTraining = vi.fn();

    await expect(
      scheduleExam(
        {
          exams,
          attempts,
          launches,
          trainingDelivery: testTrainingDelivery({
            ...makeLabs(),
            createTraining,
          }),
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
          scheduledFor: new Date("2026-06-15T17:00:00.000Z"),
        },
      ),
    ).rejects.toMatchObject({
      name: "ScheduleOverlapError",
      nextAvailableAt: new Date("2026-06-15T17:30:00.000Z"),
    });

    expect(createTraining).not.toHaveBeenCalled();
  });

  it("removes a failed provisioning attempt from the candidate lifecycle and does not create a lab launch", async () => {
    const { exams, attempts, launches } = await setup();
    const order: string[] = [];
    const sponsoredLink = vi.fn();

    await expect(
      scheduleExam(
        {
          exams,
          attempts,
          launches,
          trainingDelivery: testTrainingDelivery({
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
            async ensureTrainingUserPropertyKeys() {
              order.push("ensureUserProperties");
              return {
                trainingId: "training-1",
                requiredKeys: ["certalisExamAttemptId", "certalisCandidateId"],
                availableKeys: ["certalisExamAttemptId", "certalisCandidateId"],
                definitions: [
                  { id: "certalisExamAttemptId", name: "certalisExamAttemptId" },
                  { id: "certalisCandidateId", name: "certalisCandidateId" },
                ],
              };
            },
            async addParticipant() {
              order.push("addParticipant");
              throw new Error("forbidden");
            },
            createSponsoredLink: sponsoredLink,
            async provisionIndividual(input) {
              const lowLevel = this as unknown as LabProvisioner;
              const training = await lowLevel.createTraining!(input.training);
              const userProperties = await lowLevel.ensureTrainingUserPropertyKeys!({
                trainingId: training.trainingId,
                experienceId: training.trainingId,
                requiredKeys: ["certalisExamAttemptId", "certalisCandidateId"],
              });
              let participant;
              try {
                participant = await lowLevel.addParticipant!({
                  ...input.participant,
                  trainingId: training.trainingId,
                });
              } catch (cause) {
                throw new TrainingDeliveryOperationError("add_participant", {
                  cause,
                  trainingId: training.trainingId,
                  individual: { training, userProperties },
                });
              }
              const sponsoredLinkResult = await lowLevel.createSponsoredLink!({
                trainingId: training.trainingId,
                email: input.participant.email,
                firstName: input.participant.firstName,
                lastName: input.participant.lastName,
              });
              return { training, userProperties, participant, sponsoredLink: sponsoredLinkResult };
            },
          }),
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

    expect(order).toEqual(["createTraining", "ensureUserProperties", "addParticipant"]);
    expect(sponsoredLink).not.toHaveBeenCalled();
    await expect(attempts.findById("attempt-1")).resolves.toBeNull();
    await expect(launches.findByExamAttemptId("attempt-1")).resolves.toBeNull();
  });

  it("emits a correlated diagnostic per provisioning step, anchored to the ExamAttempt, with full request/response detail", async () => {
    const { exams, attempts, launches } = await setup();
    const repository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository });

    await scheduleExam(
      {
        exams,
        attempts,
        launches,
        trainingDelivery: testTrainingDelivery({
          ...makeLabs(),
          async createSponsoredLink() {
            return {
              loginUrl: SPONSORED_LINK_URL,
              integrationSurface: "cloudshare.v4.training.sponsored_link",
              request: {
                method: "POST",
                path: "/trainings/training-1/sponsored-link",
                body: {
                  email: "candidate@helioscx.demo",
                  firstName: "Candidate",
                  lastName: "Demo",
                },
              },
              response: {
                status: 200,
                body: { loginUrl: SPONSORED_LINK_URL },
              },
            };
          },
        }),
        newId: vi.fn().mockReturnValueOnce("attempt-1").mockReturnValueOnce("launch-1"),
        now: () => new Date("2026-06-15T10:00:00.000Z"),
        diagnostics,
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-1",
        scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
        correlationId: "corr-1",
      },
    );

    // Filter by ExamAttempt ID — proves the first-class filter and that every
    // step in the thread is anchored to the attempt.
    const thread = await repository.query({ examAttemptId: "attempt-1" });
    const ops = thread.map((e) => e.operation).sort();
    expect(ops).toEqual(
      [
        "exam_attempt.schedule",
        "cloudshare.create_training",
        "cloudshare.ensure_user_properties",
        "cloudshare.add_participant",
        "cloudshare.create_sponsored_link",
        "exam_attempt.provisioned",
      ].sort(),
    );
    for (const entry of thread) {
      expect(entry).toMatchObject({
        customerId: "customer-helios",
        examId: "exam-1",
        examAttemptId: "attempt-1",
        correlationId: "corr-1",
        candidateEmail: "candidate@helioscx.demo",
        outcome: "success",
      });
    }

    const training = thread.find((e) => e.operation === "cloudshare.create_training");
    expect(training?.details).toMatchObject({
      integrationSurface: "cloudshare.v4.training",
    });
    expect(training?.externalIds).toMatchObject({
      trainingId: "training-1",
      blueprintId: "bp-1",
      teamId: "team-1",
    });
    expect((training?.request as { body?: Record<string, unknown> })?.body).toMatchObject({
      ProjectId: "project-1",
      BlueprintIds: ["bp-1"],
      PolicyId: "policy-1",
      End: "2026-06-15T17:30:00.000Z",
      Passphrase: "certalis-attempt-1",
    });
    expect(training?.response).toMatchObject({
      status: 200,
      body: { id: "training-1" },
    });

    const ensureUserProperties = thread.find((e) => e.operation === "cloudshare.ensure_user_properties");
    expect(ensureUserProperties?.details).toMatchObject({
      integrationSurface: "cloudshare.v4.training.user_properties",
    });
    expect(ensureUserProperties?.request).toMatchObject({
      method: "GET",
      path: "/trainings/training-1/users/properties",
    });

    const addParticipant = thread.find((e) => e.operation === "cloudshare.add_participant");
    expect(addParticipant?.details).toMatchObject({
      integrationSurface: "cloudshare.v4.training.participant",
    });
    expect(addParticipant?.request).toMatchObject({
      method: "POST",
      path: "/trainings/training-1/students",
      body: [{ email: "candidate@helioscx.demo", firstName: "Candidate", lastName: "Demo" }],
    });
    expect(addParticipant?.response).toMatchObject({
      status: 200,
      body: [{ email: "candidate@helioscx.demo", firstName: "Candidate", lastName: "Demo" }],
    });

    const sponsoredLink = thread.find((e) => e.operation === "cloudshare.create_sponsored_link");
    expect(sponsoredLink?.details).toMatchObject({
      integrationSurface: "cloudshare.v4.training.sponsored_link",
    });
    expect(sponsoredLink?.request).toMatchObject({
      method: "POST",
      path: "/trainings/training-1/sponsored-link",
      body: {
        email: "candidate@helioscx.demo",
        firstName: "Candidate",
        lastName: "Demo",
      },
    });
    expect(sponsoredLink?.response).toMatchObject({
      status: 200,
      body: { loginUrl: SPONSORED_LINK_URL },
    });
  });

  it("records a failure diagnostic for the failing CloudShare op and emits no later steps", async () => {
    const { exams, attempts, launches } = await setup();
    const repository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository });

    const cloudShareError = Object.assign(new Error("forbidden"), {
      name: "CloudShareRequestError",
      status: 403,
      context: {
        integrationSurface: "cloudshare.v4.training.participant",
        method: "POST",
        path: "/trainings/training-1/students",
        responseBody: '{"error":"forbidden"}',
      },
    });

    await expect(
      scheduleExam(
        {
          exams,
          attempts,
          launches,
          trainingDelivery: testTrainingDelivery({
            ...makeLabs(),
            async addParticipant() {
              throw cloudShareError;
            },
          }),
          newId: vi.fn().mockReturnValueOnce("attempt-1").mockReturnValueOnce("launch-1"),
          now: () => new Date("2026-06-15T10:00:00.000Z"),
          diagnostics,
        },
        {
          customerId: "customer-helios",
          candidateId: "candidate-1",
          candidateEmail: "candidate@helioscx.demo",
          candidateFirstName: "Asha",
          candidateLastName: "Patel",
          examId: "exam-1",
          scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
          correlationId: "corr-1",
        },
      ),
    ).rejects.toBeInstanceOf(CloudShareProvisioningError);

    const thread = await repository.query({ examAttemptId: "attempt-1" });
    const ops = thread.map((e) => e.operation);
    expect(ops).toContain("cloudshare.add_participant");
    expect(ops).not.toContain("cloudshare.create_sponsored_link");
    expect(ops).not.toContain("exam_attempt.provisioned");

    const failure = thread.find(
      (e) => e.operation === "cloudshare.add_participant" && e.outcome === "failure",
    );
    expect(failure?.details).toMatchObject({
      failureMode: "http_status",
      integrationSurface: "cloudshare.v4.training.participant",
      responseStatus: 403,
    });
    expect(failure?.response).toMatchObject({
      status: 403,
      body: '{"error":"forbidden"}',
    });
  });

  it("records an exam_attempt.provisioning_failed entry with outcome failure when addParticipant throws", async () => {
    const { exams, attempts, launches } = await setup();
    const repository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository });

    await expect(
      scheduleExam(
        {
          exams,
          attempts,
          launches,
          trainingDelivery: testTrainingDelivery({
            ...makeLabs(),
            async addParticipant() {
              throw new Error("forbidden");
            },
          }),
          newId: vi.fn().mockReturnValueOnce("attempt-1").mockReturnValueOnce("launch-1"),
          now: () => new Date("2026-06-15T10:00:00.000Z"),
          diagnostics,
        },
        {
          customerId: "customer-helios",
          candidateId: "candidate-1",
          candidateEmail: "candidate@helioscx.demo",
          candidateFirstName: "Asha",
          candidateLastName: "Patel",
          examId: "exam-1",
          scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
          correlationId: "corr-expired",
        },
      ),
    ).rejects.toBeInstanceOf(CloudShareProvisioningError);

    const thread = await repository.query({ examAttemptId: "attempt-1" });
    const failureEntry = thread.find(
      (e) => e.operation === "exam_attempt.provisioning_failed" && e.outcome === "failure",
    );
    expect(failureEntry).toBeDefined();
    expect(failureEntry?.level).toBe("error");
    expect(failureEntry?.details).toMatchObject({ failedDuring: "add_participant" });
    expect(thread.some((e) => e.operation === "exam_attempt.expired")).toBe(false);
  });

  it("records a transport-mode failure for training creation and emits no later steps", async () => {
    const { exams, attempts, launches } = await setup();
    const repository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository });

    const transportError = Object.assign(new Error("ENOTFOUND use.cloudshare.com"), {
      name: "CloudShareTransportError",
      context: {
        integrationSurface: "cloudshare.v4.training",
        method: "POST",
        path: "/trainings",
      },
    });

    await expect(
      scheduleExam(
        {
          exams,
          attempts,
          launches,
          trainingDelivery: testTrainingDelivery({
            ...makeLabs(),
            async createTraining() {
              throw transportError;
            },
          }),
          newId: vi.fn().mockReturnValueOnce("attempt-1").mockReturnValueOnce("launch-1"),
          now: () => new Date("2026-06-15T10:00:00.000Z"),
          diagnostics,
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

    const thread = await repository.query({ examAttemptId: "attempt-1" });
    const ops = thread.map((e) => e.operation);
    expect(ops).toContain("cloudshare.create_training");
    expect(ops).not.toContain("cloudshare.add_participant");
    expect(ops).not.toContain("exam_attempt.provisioned");
    const failure = thread.find(
      (e) => e.operation === "cloudshare.create_training" && e.outcome === "failure",
    );
    expect(failure?.details).toMatchObject({
      failureMode: "transport",
      integrationSurface: "cloudshare.v4.training",
    });
  });

  it("records top-level response evidence for schema-mismatch failures even when no status property is present", async () => {
    const { exams, attempts, launches } = await setup();
    const repository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository });

    const responseError = Object.assign(new Error("unexpected payload"), {
      name: "CloudShareResponseError",
      context: {
        integrationSurface: "cloudshare.v4.training.participant",
        method: "POST",
        path: "/trainings/training-1/students",
        status: 422,
        responseHeaders: { "content-type": "application/json" },
        responseBody: { error: "unexpected-shape" },
      },
    });

    await expect(
      scheduleExam(
        {
          exams,
          attempts,
          launches,
          trainingDelivery: testTrainingDelivery({
            ...makeLabs(),
            async addParticipant() {
              throw responseError;
            },
          }),
          newId: vi.fn().mockReturnValueOnce("attempt-1").mockReturnValueOnce("launch-1"),
          now: () => new Date("2026-06-15T10:00:00.000Z"),
          diagnostics,
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

    const thread = await repository.query({ examAttemptId: "attempt-1" });
    const failure = thread.find((e) => e.operation === "cloudshare.add_participant");
    expect(failure?.response).toMatchObject({
      status: 422,
      headers: { "content-type": "application/json" },
      body: { error: "unexpected-shape" },
    });
    expect(failure?.details).toMatchObject({
      failureMode: "unexpected_response",
      responseStatus: 422,
    });
  });

  it("retains sponsored-link loginUrl in failed sponsored-link diagnostics for admin support", async () => {
    const { exams, attempts, launches } = await setup();
    const repository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository });

    const leakyError = Object.assign(new Error("bad request"), {
      name: "CloudShareRequestError",
      status: 400,
      context: {
        integrationSurface: "cloudshare.v4.training.sponsored_link",
        method: "POST",
        path: "/trainings/training-1/sponsored-link",
        responseBody: {
          loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/leak-token",
        },
      },
    });

    await expect(
      scheduleExam(
        {
          exams,
          attempts,
          launches,
          trainingDelivery: testTrainingDelivery({
            ...makeLabs(),
            async createSponsoredLink() {
              throw leakyError;
            },
          }),
          newId: vi.fn().mockReturnValueOnce("attempt-1").mockReturnValueOnce("launch-1"),
          now: () => new Date("2026-06-15T10:00:00.000Z"),
          diagnostics,
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

    const thread = await repository.query({ examAttemptId: "attempt-1" });
    const failure = thread.find((e) => e.operation === "cloudshare.create_sponsored_link");
    expect(failure?.details).toMatchObject({
      failureMode: "http_status",
      integrationSurface: "cloudshare.v4.training.sponsored_link",
      responseStatus: 400,
    });
    expect(
      (failure?.details as { responseBody?: { loginUrl?: string } })?.responseBody?.loginUrl,
    ).toBe("https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/leak-token");
  });

  it("rejects non-future schedule times", async () => {
    const { exams, attempts, launches } = await setup();

    await expect(
      scheduleExam(
        {
          exams,
          attempts,
          launches,
          trainingDelivery: makeLabs(),
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
