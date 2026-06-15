import type { LabLaunchRepository } from "./lab-launch";

export interface TrainingParticipant {
  readonly email: string;
  readonly environmentId: string | null;
  readonly studentId?: string | null;
}

export interface ParticipantLister {
  listParticipants(trainingId: string): Promise<readonly TrainingParticipant[]>;
}

export interface CorrelateEnvironmentDeps {
  readonly launches: LabLaunchRepository;
  readonly participants: ParticipantLister;
}

export interface CorrelateEnvironmentInput {
  readonly examAttemptId: string;
}

export interface CorrelateEnvironmentResult {
  readonly examAttemptId: string;
  readonly trainingId: string | null;
  readonly environmentId: string | null;
  readonly correlated: boolean;
}

export async function correlateEnvironmentForExamAttempt(
  deps: CorrelateEnvironmentDeps,
  input: CorrelateEnvironmentInput,
): Promise<CorrelateEnvironmentResult> {
  const launch = await deps.launches.findByExamAttemptId(input.examAttemptId);
  if (!launch?.trainingId || !launch.participantEmail) {
    return {
      examAttemptId: input.examAttemptId,
      trainingId: launch?.trainingId ?? null,
      environmentId: launch?.environmentId ?? null,
      correlated: false,
    };
  }

  if (launch.environmentId) {
    return {
      examAttemptId: input.examAttemptId,
      trainingId: launch.trainingId,
      environmentId: launch.environmentId,
      correlated: true,
    };
  }

  const participants = await deps.participants.listParticipants(launch.trainingId);
  const participant = participants.find(
    (candidate) => candidate.email.trim().toLowerCase() === launch.participantEmail?.trim().toLowerCase(),
  );

  if (!participant?.environmentId) {
    return {
      examAttemptId: input.examAttemptId,
      trainingId: launch.trainingId,
      environmentId: null,
      correlated: false,
    };
  }

  await deps.launches.save({
    ...launch,
    environmentId: participant.environmentId,
  });

  return {
    examAttemptId: input.examAttemptId,
    trainingId: launch.trainingId,
    environmentId: participant.environmentId,
    correlated: true,
  };
}
