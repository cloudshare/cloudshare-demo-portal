import { randomUUID } from "node:crypto";

export type ExamStatus = "draft" | "published" | "archived";
export type ExamDeliveryAvailability = "individual" | "cohort" | "both";

export interface Exam {
  readonly id: string;
  readonly customerId: string;
  readonly title: string;
  readonly description: string;
  readonly timeLimitMinutes: number;
  readonly storageLeaseMinutes?: number | null;
  readonly openPeriodMinutes: number;
  readonly scoreRetrievalEnabled: boolean;
  readonly deliveryAvailability?: ExamDeliveryAvailability;
  readonly status: ExamStatus;
  readonly publishedAt: Date | null;
  readonly archivedAt?: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly projectId: string;
  readonly projectName: string;
  readonly blueprintId: string;
  readonly blueprintName: string;
  readonly snapshotId: string;
  readonly snapshotName: string;
  readonly allowedRegions: readonly ExamRegion[];
  readonly policyId: string;
  readonly policyName: string;
  readonly instructorId: string;
  readonly instructorName: string;
}

export interface ExamRegion {
  readonly id: string;
  readonly name: string;
}

export interface CreateDraftExamInput {
  readonly customerId: string;
  readonly title: string;
  readonly description: string;
  readonly timeLimitMinutes: number;
  readonly storageLeaseMinutes?: number | null;
  readonly openPeriodMinutes: number;
  readonly scoreRetrievalEnabled: boolean;
  readonly deliveryAvailability?: ExamDeliveryAvailability;
  readonly projectId: string;
  readonly projectName: string;
  readonly blueprintId: string;
  readonly blueprintName: string;
  readonly snapshotId: string;
  readonly snapshotName: string;
  readonly allowedRegions: readonly ExamRegion[];
  readonly policyId: string;
  readonly policyName: string;
  readonly instructorId: string;
  readonly instructorName: string;
}

export interface ExamRepository {
  save(exam: Exam): Promise<void>;
  findById(id: string): Promise<Exam | null>;
  listByCustomerId(customerId: string): Promise<Exam[]>;
}

export class DraftExamValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftExamValidationError";
  }
}

export class ExamNotFoundError extends Error {
  constructor(customerId: string, examId: string) {
    super(`Exam ${examId} was not found for customer ${customerId}`);
    this.name = "ExamNotFoundError";
  }
}

export class ExamStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExamStateError";
  }
}

export interface UpdateDraftExamInput {
  readonly customerId: string;
  readonly examId: string;
  readonly title: string;
  readonly description: string;
  readonly scoreRetrievalEnabled: boolean;
  readonly deliveryAvailability?: ExamDeliveryAvailability;
  readonly timeLimitMinutes: number;
  readonly storageLeaseMinutes?: number | null;
  readonly openPeriodMinutes: number;
  readonly allowedRegions: readonly ExamRegion[];
  readonly policyId: string;
  readonly policyName: string;
}

export async function createDraftExam(
  deps: {
    readonly repository: ExamRepository;
    readonly now?: () => Date;
    readonly newId?: () => string;
  },
  input: CreateDraftExamInput,
): Promise<Exam> {
  validateDraftInput(input);

  const now = (deps.now ?? (() => new Date()))();
  const exam: Exam = {
    id: (deps.newId ?? randomUUID)(),
    customerId: input.customerId.trim(),
    title: input.title.trim(),
    description: input.description.trim(),
    timeLimitMinutes: input.timeLimitMinutes,
    storageLeaseMinutes: input.storageLeaseMinutes ?? null,
    openPeriodMinutes: input.openPeriodMinutes,
    scoreRetrievalEnabled: input.scoreRetrievalEnabled,
    deliveryAvailability: input.deliveryAvailability ?? "individual",
    status: "draft",
    publishedAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    projectId: input.projectId.trim(),
    projectName: input.projectName.trim(),
    blueprintId: input.blueprintId.trim(),
    blueprintName: input.blueprintName.trim(),
    snapshotId: input.snapshotId.trim(),
    snapshotName: input.snapshotName.trim(),
    allowedRegions: input.allowedRegions.map((region) => ({
      id: region.id.trim(),
      name: region.name.trim(),
    })),
    policyId: input.policyId.trim(),
    policyName: input.policyName.trim(),
    instructorId: input.instructorId.trim(),
    instructorName: input.instructorName.trim(),
  };

  await deps.repository.save(exam);
  return exam;
}

export async function publishExam(
  deps: {
    readonly repository: ExamRepository;
    readonly now?: () => Date;
  },
  input: { readonly customerId: string; readonly examId: string },
): Promise<Exam> {
  const existing = await deps.repository.findById(input.examId);
  if (!existing || existing.customerId !== input.customerId) {
    throw new ExamNotFoundError(input.customerId, input.examId);
  }

  const now = (deps.now ?? (() => new Date()))();
  const published: Exam = {
    ...existing,
    status: "published",
    publishedAt: now,
    archivedAt: null,
    updatedAt: now,
  };

  await deps.repository.save(published);
  return published;
}

export async function updateDraftExam(
  deps: {
    readonly repository: ExamRepository;
    readonly now?: () => Date;
  },
  input: UpdateDraftExamInput,
): Promise<Exam> {
  const existing = await deps.repository.findById(input.examId);
  if (!existing || existing.customerId !== input.customerId) {
    throw new ExamNotFoundError(input.customerId, input.examId);
  }
  if (existing.status !== "draft") {
    throw new ExamStateError("Only draft exams can be edited.");
  }

  validateDraftInput({ ...existing, ...input });

  const updated: Exam = {
    ...existing,
    title: input.title.trim(),
    description: input.description.trim(),
    scoreRetrievalEnabled: input.scoreRetrievalEnabled,
    deliveryAvailability: input.deliveryAvailability ?? existing.deliveryAvailability,
    timeLimitMinutes: input.timeLimitMinutes,
    storageLeaseMinutes: input.storageLeaseMinutes ?? null,
    openPeriodMinutes: input.openPeriodMinutes,
    allowedRegions: input.allowedRegions.map((region) => ({
      id: region.id.trim(),
      name: region.name.trim(),
    })),
    policyId: input.policyId.trim(),
    policyName: input.policyName.trim(),
    updatedAt: (deps.now ?? (() => new Date()))(),
  };

  await deps.repository.save(updated);
  return updated;
}

export async function unpublishExam(
  deps: {
    readonly repository: ExamRepository;
    readonly now?: () => Date;
  },
  input: { readonly customerId: string; readonly examId: string },
): Promise<Exam> {
  const existing = await deps.repository.findById(input.examId);
  if (!existing || existing.customerId !== input.customerId) {
    throw new ExamNotFoundError(input.customerId, input.examId);
  }

  const updated: Exam = {
    ...existing,
    status: "draft",
    publishedAt: null,
    archivedAt: null,
    updatedAt: (deps.now ?? (() => new Date()))(),
  };

  await deps.repository.save(updated);
  return updated;
}

function validateDraftInput(input: CreateDraftExamInput): void {
  const requiredFields = [
    input.customerId,
    input.title,
    input.projectId,
    input.projectName,
    input.blueprintId,
    input.blueprintName,
    input.snapshotId,
    input.snapshotName,
    input.policyId,
    input.policyName,
    input.instructorId,
    input.instructorName,
  ];

  if (requiredFields.some((value) => value.trim().length === 0)) {
    throw new DraftExamValidationError("Draft exams require complete metadata and provisioning fields.");
  }

  if (
    input.allowedRegions.length === 0 ||
    input.allowedRegions.some((region) => region.id.trim().length === 0 || region.name.trim().length === 0)
  ) {
    throw new DraftExamValidationError(
      "Draft exams require at least one allowed Region from the Blueprint default Snapshot.",
    );
  }

  if (!Number.isInteger(input.timeLimitMinutes) || input.timeLimitMinutes <= 0) {
    throw new DraftExamValidationError("timeLimitMinutes must be a positive integer.");
  }
  if (!Number.isInteger(input.openPeriodMinutes) || input.openPeriodMinutes <= 0) {
    throw new DraftExamValidationError("openPeriodMinutes must be a positive integer.");
  }
  if (input.openPeriodMinutes < input.timeLimitMinutes) {
    throw new DraftExamValidationError("openPeriodMinutes must be greater than or equal to timeLimitMinutes.");
  }
  if (
    input.storageLeaseMinutes !== null &&
    input.storageLeaseMinutes !== undefined &&
    (!Number.isInteger(input.storageLeaseMinutes) || input.storageLeaseMinutes <= 0)
  ) {
    throw new DraftExamValidationError("storageLeaseMinutes must be a positive integer.");
  }
  if (
    input.storageLeaseMinutes !== null &&
    input.storageLeaseMinutes !== undefined &&
    input.openPeriodMinutes > input.storageLeaseMinutes
  ) {
    throw new DraftExamValidationError("openPeriodMinutes must be less than or equal to storageLeaseMinutes.");
  }
  if (!isExamDeliveryAvailability(input.deliveryAvailability ?? "individual")) {
    throw new DraftExamValidationError("deliveryAvailability must be individual, cohort, or both.");
  }
}

export function isExamDeliveryAvailability(value: unknown): value is ExamDeliveryAvailability {
  return value === "individual" || value === "cohort" || value === "both";
}

export async function archiveExam(
  deps: {
    readonly repository: ExamRepository;
    readonly now?: () => Date;
  },
  input: { readonly customerId: string; readonly examId: string },
): Promise<Exam> {
  const existing = await deps.repository.findById(input.examId);
  if (!existing || existing.customerId !== input.customerId) {
    throw new ExamNotFoundError(input.customerId, input.examId);
  }

  const now = (deps.now ?? (() => new Date()))();
  const updated: Exam = {
    ...existing,
    status: "archived",
    archivedAt: now,
    updatedAt: now,
  };

  await deps.repository.save(updated);
  return updated;
}

export function isIndividualExamDeliveryAvailable(
  exam: Pick<Exam, "deliveryAvailability">,
): boolean {
  return (exam.deliveryAvailability ?? "individual") !== "cohort";
}

export function isCohortExamSessionDeliveryAvailable(
  exam: Pick<Exam, "deliveryAvailability">,
): boolean {
  return exam.deliveryAvailability === "cohort" || exam.deliveryAvailability === "both";
}
