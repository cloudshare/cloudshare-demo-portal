import type { LabLaunchRepository } from "./lab-launch";

export interface TrainingParticipant {
  readonly email: string;
  readonly environmentId: string | null;
  readonly environmentStatus?: string | null;
  readonly participationStatus?: string | null;
  readonly firstJoinedAt?: string | null;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly displayName?: string | null;
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
  const participantBackfilledLaunch = await persistParticipantIdIfChanged(
    deps,
    launch,
    participant?.studentId ?? null,
  );
  const launchWithParticipantId = participantBackfilledLaunch ?? launch;

  const actionableEnvironmentId = getActionableEnvironmentId(participant);
  if (!actionableEnvironmentId) {
    if (shouldClearStaleEnvironmentCorrelation(launchWithParticipantId, participant)) {
      await deps.launches.save(clearEnvironmentCorrelation(launchWithParticipantId));
    }
    return {
      examAttemptId: input.examAttemptId,
      trainingId: launchWithParticipantId.trainingId ?? launch.trainingId,
      environmentId: null,
      correlated: false,
    };
  }

  if (
    launchWithParticipantId.environmentId !== actionableEnvironmentId ||
    launchWithParticipantId.environmentExternalId !== actionableEnvironmentId
  ) {
    await deps.launches.save({
      ...launchWithParticipantId,
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

async function persistParticipantIdIfChanged(
  deps: CorrelateEnvironmentDeps,
  launch: NonNullable<Awaited<ReturnType<LabLaunchRepository["findByExamAttemptId"]>>>,
  participantId: string | null,
) {
  if (!participantId || launch.participantId === participantId) {
    return null;
  }

  const updatedLaunch = {
    ...launch,
    participantId,
  };
  await deps.launches.save(updatedLaunch);
  return updatedLaunch;
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
