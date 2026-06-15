import type { ExamRepository } from "./exam-catalog";
import type { ExamAttempt, ExamAttemptRepository } from "./exam-attempt";
import type { LabLaunch, LabLaunchRepository, LabProvisioner } from "./lab-launch";

const COLD_START_WARNING_WINDOW_MS = 5 * 60 * 60 * 1000;
const CLOUDSHARE_TRAINING_NAME_MAX_LENGTH = 100;

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
  readonly candidateFirstName: string;
  readonly candidateLastName: string;
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
  const createdAt = deps.now();
  const attempt: ExamAttempt = {
    id: attemptId,
    candidateId: input.candidateId,
    examId: exam.id,
    status: "scheduled",
    scheduledFor: input.scheduledFor,
    createdAt,
  };

  const trainingCreator = deps.labs.createTraining;
  const participantAdder = deps.labs.addParticipant;
  if (!trainingCreator || !participantAdder) {
    throw new Error("LabProvisioner does not support training scheduling.");
  }

  let trainingId: string;
  try {
    const training = await trainingCreator({
      title: buildCloudShareTrainingName({
        blueprintName: exam.blueprintName,
        candidateFirstName: input.candidateFirstName,
        candidateLastName: input.candidateLastName,
        candidateEmail: input.candidateEmail,
        scheduledFor: input.scheduledFor,
        createdAt,
      }),
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

  const participant = {
    firstName: input.candidateFirstName.trim(),
    lastName: input.candidateLastName.trim(),
  };
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

function buildCloudShareTrainingName(input: {
  readonly blueprintName: string;
  readonly candidateFirstName: string;
  readonly candidateLastName: string;
  readonly candidateEmail: string;
  readonly scheduledFor: Date;
  readonly createdAt: Date;
}): string {
  const name = [input.candidateFirstName, input.candidateLastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
  const suffix = [formatUtcStamp(input.scheduledFor), formatUtcStamp(input.createdAt)].join(" - ");
  const identityMaxLength = CLOUDSHARE_TRAINING_NAME_MAX_LENGTH - suffix.length - " - ".length;
  const identity = fitJoinedNameParts(
    normalizeNamePart(input.blueprintName),
    normalizeNamePart(name),
    normalizeNamePart(input.candidateEmail),
    identityMaxLength,
  );
  return [identity, suffix].join(" - ");
}

function normalizeNamePart(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function fitJoinedNameParts(
  blueprintName: string,
  candidateName: string,
  candidateEmail: string,
  maxLength: number,
): string {
  const parts = [blueprintName, candidateName, candidateEmail];
  const separatorLength = " - ".length * (parts.length - 1);
  const contentMaxLength = maxLength - separatorLength;

  if (parts.join(" - ").length <= maxLength) {
    return parts.join(" - ");
  }

  const budgets = parts.map((part) => part.length);
  while (budgets.reduce((sum, value) => sum + value, 0) > contentMaxLength) {
    const largestIndex = budgets.reduce(
      (largest, value, index) => (value > budgets[largest]! ? index : largest),
      0,
    );
    budgets[largestIndex] = Math.max(1, budgets[largestIndex]! - 1);
  }

  return parts.map((part, index) => truncateNamePart(part, budgets[index]!)).join(" - ");
}

function truncateNamePart(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function formatUtcStamp(value: Date): string {
  return value.toISOString().replace(/[-:]/g, "").replace(".000", "");
}

function validateScheduledFor(scheduledFor: Date, now: Date): void {
  if (!(scheduledFor instanceof Date) || Number.isNaN(scheduledFor.getTime())) {
    throw new ScheduleValidationError("scheduledFor must be a valid datetime.");
  }

  if (scheduledFor.getTime() <= now.getTime()) {
    throw new ScheduleValidationError("scheduledFor must be in the future.");
  }
}
