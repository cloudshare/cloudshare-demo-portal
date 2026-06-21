import { computeEntitlement } from "./entitlement";
import { LabLaunchError, NotEntitledError } from "./errors";
import type { ExamAttemptRepository } from "./exam-attempt";

/**
 * The controlled CloudShare LabLaunch. Entitlement is recomputed server-side from
 * the persisted ExamAttempt (never trusted from the client), then the lab is
 * provisioned in a strict, security-driven order:
 *
 *   1. Create the Training Experience as "Registered Students Only".
 *   2. Add the Training Student — the REAL entitlement gate. If this is skipped
 *      or fails, the sponsored link would still succeed but login would be
 *      silently denied, so a failure here aborts the launch with an actionable
 *      error rather than proceeding.
 *   3. Create the Sponsored Link, returning the Classic-domain loginUrl.
 *
 * `environmentExternalId` is set at creation and persisted so the environment can
 * be correlated with this attempt later (webhooks, liveness, scoring).
 */

export type LabLaunchStatus = "launched";

export interface LabLaunch {
  readonly id: string;
  readonly examAttemptId: string;
  readonly candidateId: string;
  readonly participantEmail?: string;
  readonly participantId?: string;
  readonly trainingId?: string;
  readonly experienceId: string;
  readonly environmentExternalId?: string;
  readonly environmentId?: string;
  readonly loginUrl: string;
  readonly status: LabLaunchStatus;
  readonly createdAt: Date;
}

export interface LabLaunchRepository {
  save(launch: LabLaunch): Promise<void>;
  findById(id: string): Promise<LabLaunch | null>;
  findByExamAttemptId(examAttemptId: string): Promise<LabLaunch | null>;
  findByCustomerIdAndEnvironmentExternalId(
    customerId: string,
    environmentExternalId: string,
  ): Promise<LabLaunch | null>;
}

// --- LabProvisioner port (implemented by the CloudShare integration) ---

export interface CreateExperienceInput {
  readonly title: string;
  readonly environmentExternalId: string;
  /** Always true — the experience must be restricted to registered students. */
  readonly registeredStudentsOnly: true;
}
export interface CreateExperienceResult {
  readonly experienceId: string;
}
export interface AddStudentInput {
  readonly experienceId: string;
  readonly candidateId: string;
}
export interface CreateTrainingInput {
  readonly title: string;
  readonly scheduledFor: Date;
  readonly projectId: string;
  readonly blueprintId: string;
  readonly policyId: string;
  readonly regionIds: readonly string[];
  readonly instructorId: string;
  readonly passphrase: string;
  readonly timeZoneId: string;
}
export interface CreateTrainingResult {
  readonly trainingId: string;
  readonly teamId?: string;
  readonly teamCount?: number;
}
export interface AddParticipantInput {
  readonly trainingId: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
}
export interface CreateSponsoredLinkInput {
  readonly experienceId?: string;
  readonly trainingId?: string;
  readonly email?: string;
  readonly firstName?: string;
  readonly lastName?: string;
}
export interface CreateSponsoredLinkResult {
  readonly loginUrl: string;
}

export interface LabProvisioner {
  createTraining?(input: CreateTrainingInput): Promise<CreateTrainingResult>;
  addParticipant?(input: AddParticipantInput): Promise<void>;
  createExperience(input: CreateExperienceInput): Promise<CreateExperienceResult>;
  /** Register the candidate. Throws on failure — never resolves on a skipped registration. */
  addStudent(input: AddStudentInput): Promise<void>;
  createSponsoredLink(input: CreateSponsoredLinkInput): Promise<CreateSponsoredLinkResult>;
}

export interface LaunchLabDeps {
  readonly attempts: ExamAttemptRepository;
  readonly labs: LabProvisioner;
  readonly launches: LabLaunchRepository;
  readonly newId: () => string;
  readonly newExternalId: () => string;
  readonly now: () => Date;
}

export interface LaunchLabInput {
  readonly examAttemptId: string;
}

export async function launchLab(
  deps: LaunchLabDeps,
  input: LaunchLabInput,
): Promise<LabLaunch> {
  // Idempotency — return the existing launch rather than provisioning a second one.
  const existing = await deps.launches.findByExamAttemptId(input.examAttemptId);
  if (existing) return existing;

  // Entitlement — server-side, from persisted state only.
  const attempt = await deps.attempts.findById(input.examAttemptId);
  const entitlement = computeEntitlement(input.examAttemptId, attempt);
  if (!entitlement.allowed || !attempt) {
    throw new NotEntitledError("Not entitled to launch a lab for this exam attempt", {
      examAttemptId: input.examAttemptId,
      reason: entitlement.reason,
    });
  }

  const environmentExternalId = deps.newExternalId();

  // 1. Create experience — Registered Students Only.
  let experience: CreateExperienceResult;
  try {
    experience = await deps.labs.createExperience({
      title: `Exam ${attempt.examId}`,
      environmentExternalId,
      registeredStudentsOnly: true,
    });
  } catch (cause) {
    throw new LabLaunchError("Failed to create the training experience", {
      examAttemptId: attempt.id,
      cause: messageOf(cause),
    });
  }

  // 2. Add student — the real entitlement gate. Abort before the sponsored link
  //    so we never hand out a link that logs in to a silently-denied environment.
  try {
    await deps.labs.addStudent({
      experienceId: experience.experienceId,
      candidateId: attempt.candidateId,
    });
  } catch (cause) {
    throw new LabLaunchError(
      "Failed to register the candidate (Add Student); aborting before sponsored link to avoid a silently denied login",
      { examAttemptId: attempt.id, experienceId: experience.experienceId, cause: messageOf(cause) },
    );
  }

  // 3. Sponsored link — the Classic-domain loginUrl the candidate opens.
  let link: CreateSponsoredLinkResult;
  try {
    link = await deps.labs.createSponsoredLink({ experienceId: experience.experienceId });
  } catch (cause) {
    throw new LabLaunchError("Failed to create the sponsored login link", {
      examAttemptId: attempt.id,
      experienceId: experience.experienceId,
      cause: messageOf(cause),
    });
  }

  const launch: LabLaunch = {
    id: deps.newId(),
    examAttemptId: attempt.id,
    candidateId: attempt.candidateId,
    trainingId: experience.experienceId,
    experienceId: experience.experienceId,
    environmentExternalId,
    loginUrl: link.loginUrl,
    status: "launched",
    createdAt: deps.now(),
  };
  await deps.launches.save(launch);
  return launch;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
