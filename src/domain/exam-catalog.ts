import { randomUUID } from "node:crypto";

export type ExamStatus = "draft" | "published";

export interface Exam {
  readonly id: string;
  readonly customerId: string;
  readonly title: string;
  readonly description: string;
  readonly timeLimitMinutes: number;
  readonly scoreRetrievalEnabled: boolean;
  readonly status: ExamStatus;
  readonly publishedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly projectId: string;
  readonly projectName: string;
  readonly blueprintId: string;
  readonly blueprintName: string;
  readonly snapshotId: string;
  readonly snapshotName: string;
  readonly regionId: string;
  readonly regionName: string;
  readonly policyId: string;
  readonly policyName: string;
  readonly instructorId: string;
  readonly instructorName: string;
}

export interface CreateDraftExamInput {
  readonly customerId: string;
  readonly title: string;
  readonly description: string;
  readonly timeLimitMinutes: number;
  readonly scoreRetrievalEnabled: boolean;
  readonly projectId: string;
  readonly projectName: string;
  readonly blueprintId: string;
  readonly blueprintName: string;
  readonly snapshotId: string;
  readonly snapshotName: string;
  readonly regionId: string;
  readonly regionName: string;
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
    scoreRetrievalEnabled: input.scoreRetrievalEnabled,
    status: "draft",
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
    projectId: input.projectId.trim(),
    projectName: input.projectName.trim(),
    blueprintId: input.blueprintId.trim(),
    blueprintName: input.blueprintName.trim(),
    snapshotId: input.snapshotId.trim(),
    snapshotName: input.snapshotName.trim(),
    regionId: input.regionId.trim(),
    regionName: input.regionName.trim(),
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
    input.regionId,
    input.regionName,
    input.policyId,
    input.policyName,
    input.instructorId,
    input.instructorName,
  ];

  if (requiredFields.some((value) => value.trim().length === 0)) {
    throw new DraftExamValidationError("Draft exams require complete metadata and provisioning fields.");
  }

  if (!Number.isInteger(input.timeLimitMinutes) || input.timeLimitMinutes <= 0) {
    throw new DraftExamValidationError("timeLimitMinutes must be a positive integer.");
  }
}
