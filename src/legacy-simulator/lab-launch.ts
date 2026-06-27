import { LabLaunchError, NotEntitledError } from "@/domain/errors";
import type { ExamAttempt, ExamAttemptRepository } from "@/domain/exam-attempt";
import type {
  CreateExperienceResult,
  LabLaunch,
  LabLaunchRepository,
  LabProvisioner,
} from "@/domain/lab-launch";

interface LegacyDemoEntitlement {
  readonly examAttemptId: string;
  readonly candidateId: string;
  readonly allowed: boolean;
  readonly reason?: string;
}

export interface LegacyLaunchLabDeps {
  readonly attempts: ExamAttemptRepository;
  readonly labs: LabProvisioner;
  readonly launches: LabLaunchRepository;
  readonly newId: () => string;
  readonly newExternalId: () => string;
  readonly now: () => Date;
}

export interface LegacyLaunchLabInput {
  readonly examAttemptId: string;
}

/**
 * Retired simulator LabLaunch flow retained only for `/api/demo` compatibility.
 *
 * Active Candidate scheduling provisions CloudShare training in
 * `src/domain/scheduling.ts`; this legacy helper exists only to support the old
 * deterministic `book_exam` -> `launch_lab` demo sequence whose ExamAttempt
 * starts in the retired `booked` status.
 */
export async function launchLegacySimulatorLab(
  deps: LegacyLaunchLabDeps,
  input: LegacyLaunchLabInput,
): Promise<LabLaunch> {
  const existing = await deps.launches.findByExamAttemptId(input.examAttemptId);
  if (existing) return existing;

  const attempt = await deps.attempts.findById(input.examAttemptId);
  const entitlement = computeLegacyDemoEntitlement(input.examAttemptId, attempt);
  if (!entitlement.allowed || !attempt) {
    throw new NotEntitledError("Not entitled to launch a lab for this exam attempt", {
      examAttemptId: input.examAttemptId,
      reason: entitlement.reason,
    });
  }

  const environmentExternalId = deps.newExternalId();

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

  let link: Awaited<ReturnType<LabProvisioner["createSponsoredLink"]>>;
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

function computeLegacyDemoEntitlement(
  examAttemptId: string,
  attempt: ExamAttempt | null,
): LegacyDemoEntitlement {
  if (!attempt) {
    return {
      examAttemptId,
      candidateId: "",
      allowed: false,
      reason: "exam attempt not found",
    };
  }

  const allowed = attempt.status === "booked";
  return {
    examAttemptId: attempt.id,
    candidateId: attempt.candidateId,
    allowed,
    reason: allowed ? undefined : `exam attempt status "${attempt.status}" is not launchable`,
  };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
