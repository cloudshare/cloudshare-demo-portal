/**
 * The controlled CloudShare LabLaunch record. Active Candidate scheduling
 * creates this while provisioning a CloudShare training/Experience, and runtime
 * flows use it to correlate sponsored-link access, environment state, webhooks,
 * suspend/resume, and score retrieval back to an ExamAttempt.
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
  findPendingEnvironmentCorrelation?(input: {
    readonly customerId: string;
    readonly participantEmail: string;
    readonly environmentName: string | null;
  }): Promise<LabLaunch | null>;
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
  readonly endsAt: Date;
  readonly externalId?: string;
  readonly projectId: string;
  readonly blueprintId: string;
  readonly policyId: string;
  readonly regionIds: readonly string[];
  readonly instructorId: string;
  readonly passphrase: string;
  readonly timeZoneId: string;
}
export interface ProvisioningRequestEvidence {
  readonly method: string;
  readonly path: string;
  readonly query?: Record<string, string>;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
}
export interface ProvisioningResponseEvidence {
  readonly status: number;
  readonly headers?: Record<string, string | string[]>;
  readonly body: unknown;
}
export interface CreateTrainingResult {
  readonly trainingId: string;
  readonly teamId?: string;
  readonly teamCount?: number;
  readonly integrationSurface?: string;
  readonly request?: ProvisioningRequestEvidence;
  readonly response?: ProvisioningResponseEvidence;
}
export interface AddParticipantInput {
  readonly trainingId: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly certalisExamAttemptId?: string;
  readonly certalisCandidateId?: string;
}

export const CERTALIS_TRAINING_USER_PROPERTY_KEYS = [
  "certalisExamAttemptId",
  "certalisCandidateId",
] as const;

export type CertalisTrainingUserPropertyKey =
  (typeof CERTALIS_TRAINING_USER_PROPERTY_KEYS)[number];

export interface AddParticipantResult {
  readonly participantId?: string;
  readonly integrationSurface?: string;
  readonly request?: ProvisioningRequestEvidence;
  readonly response: {
    readonly status: number;
    readonly headers?: Record<string, string | string[]>;
    readonly body: unknown;
  };
}
export interface EnsureTrainingUserPropertyKeysInput {
  readonly trainingId: string;
  readonly experienceId?: string;
  readonly requiredKeys: readonly string[];
}
export interface TrainingUserPropertyDefinition {
  readonly id: string;
  readonly name: string;
  readonly type?: number | null;
  readonly isRequired?: boolean;
  readonly regex?: string | null;
  readonly defaultValue?: string | null;
  readonly value?: string | null;
}
export interface EnsureTrainingUserPropertyKeysResult {
  readonly trainingId?: string;
  readonly experienceId?: string;
  readonly requiredKeys: readonly string[];
  readonly availableKeys: readonly string[];
  readonly definitions: readonly TrainingUserPropertyDefinition[];
  readonly integrationSurface?: string;
  readonly request?: ProvisioningRequestEvidence;
  readonly response?: ProvisioningResponseEvidence;
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
  readonly integrationSurface?: string;
  readonly request?: ProvisioningRequestEvidence;
  readonly response?: ProvisioningResponseEvidence;
}
export interface GetTrainingStartStateInput {
  readonly trainingId: string;
}
export interface GetTrainingStartStateResult {
  readonly trainingId: string;
  readonly status?: string;
  readonly startsAt?: Date;
  readonly rawStartsAt?: string;
  readonly timeZone?: string;
  readonly integrationSurface?: string;
  readonly request?: ProvisioningRequestEvidence;
  readonly response?: ProvisioningResponseEvidence;
}

export interface LabProvisioner {
  createTraining?(input: CreateTrainingInput): Promise<CreateTrainingResult>;
  ensureTrainingUserPropertyKeys?(
    input: EnsureTrainingUserPropertyKeysInput,
  ): Promise<EnsureTrainingUserPropertyKeysResult>;
  getTrainingStartState?(
    input: GetTrainingStartStateInput,
  ): Promise<GetTrainingStartStateResult>;
  addParticipant?(input: AddParticipantInput): Promise<AddParticipantResult>;
  createExperience(input: CreateExperienceInput): Promise<CreateExperienceResult>;
  /** Register the candidate. Throws on failure — never resolves on a skipped registration. */
  addStudent(input: AddStudentInput): Promise<void>;
  createSponsoredLink(input: CreateSponsoredLinkInput): Promise<CreateSponsoredLinkResult>;
}
