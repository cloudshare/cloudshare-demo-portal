import type { ExamRepository } from "./exam-catalog";
import type { ExamAttempt, ExamAttemptRepository } from "./exam-attempt";
import type { LabLaunch, LabLaunchRepository, LabProvisioner } from "./lab-launch";

const COLD_START_WARNING_WINDOW_MS = 5 * 60 * 60 * 1000;

export class ScheduleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleValidationError";
  }
}

export class ScheduleExamNotFoundError extends Error {
  constructor() {
    super("Published exam not found.");
    this.name = "ScheduleExamNotFoundError";
  }
}

export class CloudShareProvisioningError extends Error {
  constructor(
    message: string,
    readonly context: {
      readonly attemptId: string;
      readonly attemptedOperation: "create_training" | "add_participant" | "create_sponsored_link";
      readonly trainingId?: string;
      readonly cause: unknown;
    },
  ) {
    super(message);
    this.name = "CloudShareProvisioningError";
  }
}

export interface ScheduleExamDeps {
  readonly exams: ExamRepository;
  readonly attempts: ExamAttemptRepository;
  readonly launches: LabLaunchRepository;
  readonly labs: LabProvisioner;
  readonly newId: () => string;
  readonly now: () => Date;
}

export interface ScheduleExamInput {
  readonly customerId: string;
  readonly candidateId: string;
  readonly candidateEmail: string;
  readonly examId: string;
  readonly scheduledFor: Date;
}

export interface ScheduledAttemptSummary {
  readonly id: string;
  readonly examId: string;
  readonly scheduledFor: string;
  readonly status: "scheduled" | "ready";
}

export interface ScheduleExamResult {
  readonly attempt: ScheduledAttemptSummary;
  readonly coldStartLikely: boolean;
}

export async function scheduleExam(
  deps: ScheduleExamDeps,
  input: ScheduleExamInput,
): Promise<ScheduleExamResult> {
  validateScheduledFor(input.scheduledFor, deps.now());

  const exam = await deps.exams.findById(input.examId);
  if (!exam || exam.customerId !== input.customerId || exam.status !== "published") {
    throw new ScheduleExamNotFoundError();
  }

  const attemptId = deps.newId();
  const attempt: ExamAttempt = {
    id: attemptId,
    candidateId: input.candidateId,
    examId: exam.id,
    status: "scheduled",
    scheduledFor: input.scheduledFor,
    createdAt: deps.now(),
  };

  const trainingCreator = deps.labs.createTraining;
  const participantAdder = deps.labs.addParticipant;
  if (!trainingCreator || !participantAdder) {
    throw new Error("LabProvisioner does not support training scheduling.");
  }

  let trainingId: string;
  try {
    const training = await trainingCreator({
      title: exam.title,
      scheduledFor: input.scheduledFor,
      projectId: exam.projectId,
      blueprintId: exam.blueprintId,
      policyId: exam.policyId,
      regionIds: exam.allowedRegions.map((region) => region.id),
      instructorId: exam.instructorId,
      passphrase: `certalis-${attemptId}`,
      timeZoneId: "UTC",
    });
    trainingId = training.trainingId;
  } catch (cause) {
    throw new CloudShareProvisioningError("CloudShare training creation failed.", {
      attemptId,
      attemptedOperation: "create_training",
      cause,
    });
  }

  const participant = toParticipant(input.candidateEmail);
  try {
    await participantAdder({
      trainingId,
      email: input.candidateEmail,
      firstName: participant.firstName,
      lastName: participant.lastName,
    });
  } catch (cause) {
    throw new CloudShareProvisioningError("CloudShare participant registration failed.", {
      attemptId,
      attemptedOperation: "add_participant",
      trainingId,
      cause,
    });
  }

  let loginUrl: string;
  try {
    const sponsoredLink = await deps.labs.createSponsoredLink({
      trainingId,
      email: input.candidateEmail,
      firstName: participant.firstName,
      lastName: participant.lastName,
    });
    loginUrl = sponsoredLink.loginUrl;
  } catch (cause) {
    throw new CloudShareProvisioningError("CloudShare sponsored-link creation failed.", {
      attemptId,
      attemptedOperation: "create_sponsored_link",
      trainingId,
      cause,
    });
  }

  const readyAttempt: ExamAttempt = { ...attempt, status: "ready" };
  const launch: LabLaunch = {
    id: deps.newId(),
    examAttemptId: attempt.id,
    candidateId: input.candidateId,
    trainingId,
    experienceId: trainingId,
    loginUrl,
    status: "launched",
    createdAt: deps.now(),
  };
  await deps.attempts.save(readyAttempt);
  await deps.launches.save(launch);

  return {
    attempt: {
      id: readyAttempt.id,
      examId: readyAttempt.examId,
      scheduledFor: input.scheduledFor.toISOString(),
      status: "ready",
    },
    coldStartLikely: input.scheduledFor.getTime() - deps.now().getTime() < COLD_START_WARNING_WINDOW_MS,
  };
}

function validateScheduledFor(scheduledFor: Date, now: Date): void {
  if (!(scheduledFor instanceof Date) || Number.isNaN(scheduledFor.getTime())) {
    throw new ScheduleValidationError("scheduledFor must be a valid datetime.");
  }

  if (scheduledFor.getTime() <= now.getTime()) {
    throw new ScheduleValidationError("scheduledFor must be in the future.");
  }
}

function toParticipant(email: string): { firstName: string; lastName: string } {
  const localPart = email.split("@")[0]?.trim() || "Candidate";
  const normalized = localPart.replace(/[._-]+/g, " ").trim();
  const [first = "Candidate", ...rest] = normalized.split(/\s+/);
  return {
    firstName: capitalize(first),
    lastName: rest.length > 0 ? rest.map(capitalize).join(" ") : "Candidate",
  };
}

function capitalize(value: string): string {
  if (value.length === 0) {
    return value;
  }
  return value[0].toUpperCase() + value.slice(1);
}
