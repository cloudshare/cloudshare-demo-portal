import type {
  CohortParticipantAdmissionInput,
  CohortParticipantAdmissionResult,
  CohortTrainingDelivery,
  CohortTrainingPublicationInput,
  CohortTrainingPublicationResult,
  IndividualTrainingDelivery,
  IndividualTrainingProvisioningInput,
  IndividualTrainingProvisioningResult,
  LabProvisioner,
  TrainingDeliveryOperation,
} from "@/domain/lab-launch";
import {
  CERTALIS_TRAINING_USER_PROPERTY_KEYS,
  TrainingDeliveryOperationError,
} from "@/domain/lab-launch";
import type {
  ParticipantProgressDiagnostics,
} from "@/domain/score-result";
import type { ParticipantLister, TrainingParticipant } from "@/domain/environment-correlation";
import type { CloudShareClient } from "./client";
import {
  createCloudShareOnDemandExperienceCreator,
} from "./cohort-experiences";
import {
  createCloudShareTrainingRetirementWriter,
  type RetireCloudShareTrainingResult,
} from "./cohort-experience-retirement";
import {
  type AggregateGuidedJourneyDiagnostics,
  type AggregateGuidedJourneyProgress,
  createCloudShareAggregateGuidedJourneyProvider,
  createCloudShareGuidedJourneyProvider,
} from "./guided-journey";
import {
  createCloudShareLabProvisioner,
  type CloudShareLabProvisionerObserver,
} from "./labs";
import {
  createCloudShareParticipantLister,
  createCloudShareTrainingParticipantReader,
  type TrainingParticipantReadResult,
} from "./participants";

export type {
  AggregateGuidedJourneyDiagnostics,
  AggregateGuidedJourneyProgress,
} from "./guided-journey";
export { SCORING_LIMITATIONS } from "./guided-journey";
export type { CloudShareLabProvisionerObserver } from "./labs";
export type { TrainingParticipantReadResult } from "./participants";

/**
 * The Training-only delivery interface over a single Customer-scoped CloudShare
 * client. It deliberately has no Sales or generic Experience counterpart: the
 * documented Sales workflow must establish its own concrete adapter first.
 */
export interface TrainingDelivery extends IndividualTrainingDelivery, CohortTrainingDelivery {
  listParticipants(trainingId: string): Promise<readonly TrainingParticipant[]>;
  readParticipants(trainingId: string): Promise<TrainingParticipantReadResult>;
  retireTrainingToEnd(input: {
    readonly trainingId: string;
    readonly end: Date;
  }): Promise<RetireCloudShareTrainingResult>;
  getParticipantProgress(
    experienceId: string,
    participantId: string,
  ): Promise<ParticipantProgressDiagnostics["progress"]>;
  getParticipantProgressForDiagnostics(
    experienceId: string,
    participantId: string,
  ): Promise<ParticipantProgressDiagnostics>;
  getAggregateProgress(experienceId: string): Promise<AggregateGuidedJourneyProgress | null>;
  getAggregateProgressForDiagnostics(
    experienceId: string,
  ): Promise<AggregateGuidedJourneyDiagnostics>;
}

export interface CreateCloudShareTrainingDeliveryOptions {
  readonly observer?: CloudShareLabProvisionerObserver;
}

/**
 * Builds the one Training delivery module for a Customer-scoped CloudShare
 * client. Connection lookup and portal admission/state orchestration stay in
 * runtime handlers under ADR-001 through ADR-005.
 */
export function createCloudShareTrainingDelivery(
  client: CloudShareClient,
  options: CreateCloudShareTrainingDeliveryOptions = {},
): TrainingDelivery {
  let labs: LabProvisioner | undefined;
  let cohorts: ReturnType<typeof createCloudShareOnDemandExperienceCreator> | undefined;
  let participantLister: ParticipantLister | undefined;
  let participantReader: ReturnType<typeof createCloudShareTrainingParticipantReader> | undefined;
  let retirement: ReturnType<typeof createCloudShareTrainingRetirementWriter> | undefined;
  let guidedJourney: ReturnType<typeof createCloudShareGuidedJourneyProvider> | undefined;
  let aggregateGuidedJourney: ReturnType<typeof createCloudShareAggregateGuidedJourneyProvider> | undefined;

  const getLabs = () => (labs ??= createCloudShareLabProvisioner(client, options.observer));
  const getCohorts = () => (cohorts ??= createCloudShareOnDemandExperienceCreator(client));
  const getParticipantLister = () => (participantLister ??= createCloudShareParticipantLister(client));
  const getParticipantReader = () =>
    (participantReader ??= createCloudShareTrainingParticipantReader(client));
  const getRetirement = () => (retirement ??= createCloudShareTrainingRetirementWriter(client));
  const getGuidedJourney = () => (guidedJourney ??= createCloudShareGuidedJourneyProvider(client));
  const getAggregateGuidedJourney = () =>
    (aggregateGuidedJourney ??= createCloudShareAggregateGuidedJourneyProvider(client));

  return {
    provisionIndividual: (input) => provisionIndividual(getLabs(), input),
    publishCohortTraining: (input) => publishCohortTraining(getLabs(), getCohorts(), input),
    admitCohortParticipant: (input) => admitCohortParticipant(getLabs(), input),
    listParticipants: (trainingId) => getParticipantLister().listParticipants(trainingId),
    readParticipants: (trainingId) => getParticipantReader().readParticipants(trainingId),
    retireTrainingToEnd: (input) => getRetirement().retireTrainingToEnd(input),
    getParticipantProgress: (experienceId, participantId) =>
      getGuidedJourney().getParticipantProgress(experienceId, participantId),
    getParticipantProgressForDiagnostics: (experienceId, participantId) =>
      getGuidedJourney().getParticipantProgressForDiagnostics(experienceId, participantId),
    getAggregateProgress: (experienceId) => getAggregateGuidedJourney().getAggregateProgress(experienceId),
    getAggregateProgressForDiagnostics: (experienceId) =>
      getAggregateGuidedJourney().getAggregateProgressForDiagnostics(experienceId),
  };
}

function requireTrainingOperation<Input, Result>(
  operation: ((input: Input) => Promise<Result>) | undefined,
  operationName: string,
): (input: Input) => Promise<Result> {
  if (!operation) {
    throw new Error(`CloudShare Training delivery cannot ${operationName}.`);
  }
  return operation;
}

async function provisionIndividual(
  labs: LabProvisioner,
  input: IndividualTrainingProvisioningInput,
): Promise<IndividualTrainingProvisioningResult> {
  let training: IndividualTrainingProvisioningResult["training"];
  try {
    training = await requireTrainingOperation(labs.createTraining, "create Training")(input.training);
  } catch (cause) {
    throw deliveryFailure("create_training", cause);
  }

  let userProperties: IndividualTrainingProvisioningResult["userProperties"];
  try {
    userProperties = await requireTrainingOperation(
      labs.ensureTrainingUserPropertyKeys,
      "ensure Training user-property keys",
    )({
      trainingId: training.trainingId,
      experienceId: training.trainingId,
      requiredKeys: CERTALIS_TRAINING_USER_PROPERTY_KEYS,
    });
  } catch (cause) {
    throw deliveryFailure("ensure_user_properties", cause, {
      trainingId: training.trainingId,
      experienceId: training.trainingId,
      individual: { training },
    });
  }

  let participant: IndividualTrainingProvisioningResult["participant"];
  try {
    participant = await requireTrainingOperation(labs.addParticipant, "add a Training participant")({
      ...input.participant,
      trainingId: training.trainingId,
    });
  } catch (cause) {
    throw deliveryFailure("add_participant", cause, {
      trainingId: training.trainingId,
      experienceId: training.trainingId,
      individual: { training, userProperties },
    });
  }

  try {
    const sponsoredLink = await labs.createSponsoredLink({
      trainingId: training.trainingId,
      email: input.participant.email,
      firstName: input.participant.firstName,
      lastName: input.participant.lastName,
    });
    return { training, userProperties, participant, sponsoredLink };
  } catch (cause) {
    throw deliveryFailure("create_sponsored_link", cause, {
      trainingId: training.trainingId,
      experienceId: training.trainingId,
      individual: { training, userProperties, participant },
    });
  }
}

async function publishCohortTraining(
  labs: LabProvisioner,
  cohorts: ReturnType<typeof createCloudShareOnDemandExperienceCreator>,
  input: CohortTrainingPublicationInput,
): Promise<CohortTrainingPublicationResult> {
  let created: Omit<CohortTrainingPublicationResult, "userProperties">;
  try {
    created = await cohorts.createOnDemandExperience(input);
  } catch (cause) {
    throw deliveryFailure("create_training", cause);
  }

  try {
    const userProperties = await requireTrainingOperation(
      labs.ensureTrainingUserPropertyKeys,
      "ensure Training user-property keys",
    )({
      trainingId: created.trainingId,
      experienceId: created.experienceId,
      requiredKeys: CERTALIS_TRAINING_USER_PROPERTY_KEYS,
    });
    return { ...created, userProperties };
  } catch (cause) {
    throw deliveryFailure("ensure_user_properties", cause, {
      trainingId: created.trainingId,
      experienceId: created.experienceId,
      publication: created,
    });
  }
}

async function admitCohortParticipant(
  labs: LabProvisioner,
  input: CohortParticipantAdmissionInput,
): Promise<CohortParticipantAdmissionResult> {
  let startState: CohortParticipantAdmissionResult["startState"];
  try {
    startState = await requireTrainingOperation(
      labs.getTrainingStartState,
      "read Training start state",
    )({ trainingId: input.trainingId });
  } catch (cause) {
    throw deliveryFailure("read_training", cause, {
      trainingId: input.trainingId,
      experienceId: input.experienceId,
    });
  }

  if (startState.startsAt && startState.startsAt.getTime() > input.now.getTime()) {
    return { admission: "not_started", startState };
  }

  let userProperties: Extract<CohortParticipantAdmissionResult, { admission: "open" }>["userProperties"];
  try {
    userProperties = await requireTrainingOperation(
      labs.ensureTrainingUserPropertyKeys,
      "ensure Training user-property keys",
    )({
      trainingId: input.trainingId,
      experienceId: input.experienceId,
      requiredKeys: CERTALIS_TRAINING_USER_PROPERTY_KEYS,
    });
  } catch (cause) {
    throw deliveryFailure("ensure_user_properties", cause, {
      trainingId: input.trainingId,
      experienceId: input.experienceId,
      cohort: { admission: "open", startState },
    });
  }

  let participant: Extract<CohortParticipantAdmissionResult, { admission: "open" }>["participant"];
  try {
    participant = await requireTrainingOperation(labs.addParticipant, "add a Training participant")({
      ...input.participant,
      trainingId: input.trainingId,
    });
  } catch (cause) {
    throw deliveryFailure("add_participant", cause, {
      trainingId: input.trainingId,
      experienceId: input.experienceId,
      cohort: { admission: "open", startState, userProperties },
    });
  }

  try {
    const sponsoredLink = await labs.createSponsoredLink({
      trainingId: input.trainingId,
      email: input.participant.email,
      firstName: input.participant.firstName,
      lastName: input.participant.lastName,
    });
    return { admission: "open", startState, userProperties, participant, sponsoredLink };
  } catch (cause) {
    throw deliveryFailure("create_sponsored_link", cause, {
      trainingId: input.trainingId,
      experienceId: input.experienceId,
      cohort: { admission: "open", startState, userProperties, participant },
    });
  }
}

function deliveryFailure(
  operation: TrainingDeliveryOperation,
  cause: unknown,
  context: Omit<ConstructorParameters<typeof TrainingDeliveryOperationError>[1], "cause"> = {},
): TrainingDeliveryOperationError {
  return new TrainingDeliveryOperationError(operation, { cause, ...context });
}
