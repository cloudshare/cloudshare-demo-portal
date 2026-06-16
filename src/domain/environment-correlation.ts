import type { LabLaunchRepository } from "./lab-launch";

export interface TrainingParticipant {
  readonly email: string;
  readonly environmentId: string | null;
  readonly environmentStatus?: string | null;
  readonly participationStatus?: string | null;
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

  const participants = await deps.participants.listParticipants(launch.trainingId);
  const participant = participants.find(
    (candidate) => candidate.email.trim().toLowerCase() === launch.participantEmail?.trim().toLowerCase(),
  );

  const actionableEnvironmentId = getActionableEnvironmentId(participant);
  if (!actionableEnvironmentId) {
    if (shouldClearStaleEnvironmentCorrelation(launch, participant)) {
      await deps.launches.save(clearEnvironmentCorrelation(launch));
    }
    return {
      examAttemptId: input.examAttemptId,
      trainingId: launch.trainingId,
      environmentId: null,
      correlated: false,
    };
  }

  if (
    launch.environmentId !== actionableEnvironmentId ||
    launch.environmentExternalId !== actionableEnvironmentId
  ) {
    await deps.launches.save({
      ...launch,
      environmentId: actionableEnvironmentId,
      environmentExternalId: actionableEnvironmentId,
    });
  }

  return {
    examAttemptId: input.examAttemptId,
    trainingId: launch.trainingId,
    environmentId: actionableEnvironmentId,
    correlated: true,
  };
}

function getActionableEnvironmentId(
  participant: TrainingParticipant | undefined,
): string | null {
  if (!participant?.environmentId) {
    return null;
  }
  if (!hasActionableEnvironmentStatus(participant.environmentStatus)) {
    return null;
  }
  return participant.environmentId;
}

function hasActionableEnvironmentStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && status.trim().length > 0;
}

function shouldClearStaleEnvironmentCorrelation(
  launch: {
    readonly environmentId?: string;
    readonly environmentExternalId?: string;
  },
  participant: TrainingParticipant | undefined,
): boolean {
  if (!participant?.environmentId || hasActionableEnvironmentStatus(participant.environmentStatus)) {
    return false;
  }

  return (
    launch.environmentId === participant.environmentId ||
    launch.environmentExternalId === participant.environmentId
  );
}

function clearEnvironmentCorrelation<
  TLaunch extends {
    readonly environmentId?: string;
    readonly environmentExternalId?: string;
  },
>(launch: TLaunch): Omit<TLaunch, "environmentId" | "environmentExternalId"> {
  const { environmentId: _environmentId, environmentExternalId: _environmentExternalId, ...rest } = launch;
  return rest;
}
