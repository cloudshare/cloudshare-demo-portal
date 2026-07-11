import type {
  AddParticipantInput,
  AddParticipantResult,
  AddStudentInput,
  CreateExperienceInput,
  CreateExperienceResult,
  CreateSponsoredLinkInput,
  CreateSponsoredLinkResult,
  CreateTrainingInput,
  CreateTrainingResult,
  EnsureTrainingUserPropertyKeysInput,
  EnsureTrainingUserPropertyKeysResult,
  GetTrainingStartStateInput,
  GetTrainingStartStateResult,
  LabProvisioner,
} from "@/domain/lab-launch";
import type {
  ParticipantProgressDiagnostics,
} from "@/domain/score-result";
import type { ParticipantLister, TrainingParticipant } from "@/domain/environment-correlation";
import type { CloudShareClient } from "./client";
import {
  createCloudShareOnDemandExperienceCreator,
  type CreateOnDemandExperienceRequest,
  type CreateOnDemandExperienceResult,
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
export type { CloudShareLabProvisionerObserver } from "./labs";
export type { TrainingParticipantReadResult } from "./participants";

/**
 * The Training-only delivery interface over a single Customer-scoped CloudShare
 * client. It deliberately has no Sales or generic Experience counterpart: the
 * documented Sales workflow must establish its own concrete adapter first.
 */
export interface TrainingDelivery extends LabProvisioner {
  createTraining(input: CreateTrainingInput): Promise<CreateTrainingResult>;
  ensureTrainingUserPropertyKeys(
    input: EnsureTrainingUserPropertyKeysInput,
  ): Promise<EnsureTrainingUserPropertyKeysResult>;
  getTrainingStartState(input: GetTrainingStartStateInput): Promise<GetTrainingStartStateResult>;
  addParticipant(input: AddParticipantInput): Promise<AddParticipantResult>;
  createExperience(input: CreateExperienceInput): Promise<CreateExperienceResult>;
  addStudent(input: AddStudentInput): Promise<void>;
  createSponsoredLink(input: CreateSponsoredLinkInput): Promise<CreateSponsoredLinkResult>;
  createCohortTraining(input: CreateOnDemandExperienceRequest): Promise<CreateOnDemandExperienceResult>;
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
    createTraining: (input) => requireTrainingOperation(getLabs().createTraining, "create Training")(input),
    ensureTrainingUserPropertyKeys: (input) =>
      requireTrainingOperation(getLabs().ensureTrainingUserPropertyKeys, "ensure Training user-property keys")(input),
    getTrainingStartState: (input) =>
      requireTrainingOperation(getLabs().getTrainingStartState, "read Training start state")(input),
    addParticipant: (input) => requireTrainingOperation(getLabs().addParticipant, "add a Training participant")(input),
    createExperience: (input) => getLabs().createExperience(input),
    addStudent: (input) => getLabs().addStudent(input),
    createSponsoredLink: (input) => getLabs().createSponsoredLink(input),
    createCohortTraining: (input) => getCohorts().createOnDemandExperience(input),
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
