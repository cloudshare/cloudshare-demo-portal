import { randomUUID } from "node:crypto";
import type { Exam } from "./exam-catalog";

export type CohortExamSessionStatus =
  | "draft"
  | "publishing"
  | "published"
  | "closed"
  | "retired"
  | "publish_reconciliation_required";

export interface CohortExamSession {
  readonly id: string;
  readonly customerId: string;
  readonly examId: string;
  readonly name: string;
  readonly admissionStartsAt: Date;
  readonly admissionEndsAt: Date | null;
  readonly capacity: number | null;
  readonly status: CohortExamSessionStatus;
  readonly cloudShareTrainingId?: string | null;
  readonly cloudShareExperienceId?: string | null;
  readonly cloudShareTeamId?: string | null;
  readonly publishedAt?: Date | null;
  readonly admissionClosedAt?: Date | null;
  readonly retiredAt?: Date | null;
  readonly lastPublishError?: string | null;
  readonly lastPublishCorrelationId?: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CohortExamSessionWithInheritedContext {
  readonly session: CohortExamSession;
  readonly inheritedContext: CohortExamSessionInheritedContext;
}

export interface CohortExamSessionInheritedContext {
  readonly project: { readonly id: string; readonly name: string };
  readonly blueprint: { readonly id: string; readonly name: string };
  readonly snapshot: { readonly id: string; readonly name: string };
  readonly policy: { readonly id: string; readonly name: string };
  readonly allowedRegions: Exam["allowedRegions"];
  readonly instructor: { readonly id: string; readonly name: string };
  readonly scoreRetrievalEnabled: boolean;
  readonly timeLimitMinutes: number;
}

export interface CohortExamSessionRepository {
  save(session: CohortExamSession): Promise<void>;
  findById(id: string): Promise<CohortExamSession | null>;
  listByExamId(examId: string): Promise<CohortExamSession[]>;
  claimDraftForPublishing(input: {
    readonly id: string;
    readonly customerId: string;
    readonly examId: string;
    readonly claimedAt: Date;
  }): Promise<CohortExamSession | null>;
}

export class CohortExamSessionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CohortExamSessionValidationError";
  }
}

export async function createDraftCohortExamSession(
  deps: {
    readonly repository: CohortExamSessionRepository;
    readonly now?: () => Date;
    readonly newId?: () => string;
  },
  input: {
    readonly customerId: string;
    readonly examId: string;
    readonly name: string;
    readonly admissionStartsAt: Date;
    readonly admissionEndsAt?: Date | null;
    readonly capacity?: number | null;
  },
): Promise<CohortExamSession> {
  validateDraftSessionInput(input);
  const now = (deps.now ?? (() => new Date()))();
  const session: CohortExamSession = {
    id: (deps.newId ?? randomUUID)(),
    customerId: input.customerId.trim(),
    examId: input.examId.trim(),
    name: input.name.trim(),
    admissionStartsAt: input.admissionStartsAt,
    admissionEndsAt: input.admissionEndsAt ?? null,
    capacity: input.capacity ?? null,
    status: "draft",
    cloudShareTrainingId: null,
    cloudShareExperienceId: null,
    cloudShareTeamId: null,
    publishedAt: null,
    admissionClosedAt: null,
    retiredAt: null,
    lastPublishError: null,
    lastPublishCorrelationId: null,
    createdAt: now,
    updatedAt: now,
  };
  await deps.repository.save(session);
  return session;
}

export async function markCohortExamSessionPublished(
  deps: {
    readonly repository: CohortExamSessionRepository;
    readonly now?: () => Date;
  },
  input: {
    readonly session: CohortExamSession;
    readonly trainingId: string;
    readonly experienceId: string;
    readonly teamId?: string | null;
  },
): Promise<CohortExamSession> {
  if (input.session.status !== "publishing") {
    throw new CohortExamSessionValidationError("Only claimed Cohort Exam Sessions can be published.");
  }
  if (!input.trainingId.trim() || !input.experienceId.trim()) {
    throw new CohortExamSessionValidationError("CloudShare training and Experience identifiers are required.");
  }
  const now = (deps.now ?? (() => new Date()))();
  const published: CohortExamSession = {
    ...input.session,
    status: "published",
    cloudShareTrainingId: input.trainingId.trim(),
    cloudShareExperienceId: input.experienceId.trim(),
    cloudShareTeamId: input.teamId?.trim() || null,
    publishedAt: now,
    admissionClosedAt: null,
    retiredAt: null,
    lastPublishError: null,
    lastPublishCorrelationId: null,
    updatedAt: now,
  };
  await deps.repository.save(published);
  return published;
}

export async function recordCohortExamSessionPublishFailure(
  deps: {
    readonly repository: CohortExamSessionRepository;
    readonly now?: () => Date;
  },
  input: {
    readonly session: CohortExamSession;
    readonly error: string;
    readonly correlationId: string;
  },
): Promise<CohortExamSession> {
  const now = (deps.now ?? (() => new Date()))();
  const recoverable: CohortExamSession = {
    ...input.session,
    status: "draft",
    admissionClosedAt: null,
    retiredAt: null,
    lastPublishError: input.error,
    lastPublishCorrelationId: input.correlationId,
    updatedAt: now,
  };
  await deps.repository.save(recoverable);
  return recoverable;
}

export async function markCohortExamSessionPublishReconciliationRequired(
  deps: {
    readonly repository: CohortExamSessionRepository;
    readonly now?: () => Date;
  },
  input: {
    readonly session: CohortExamSession;
    readonly error: string;
    readonly correlationId: string;
    readonly trainingId?: string | null;
    readonly experienceId?: string | null;
    readonly teamId?: string | null;
  },
): Promise<CohortExamSession> {
  const now = (deps.now ?? (() => new Date()))();
  const blocked: CohortExamSession = {
    ...input.session,
    status: "publish_reconciliation_required",
    cloudShareTrainingId: input.trainingId?.trim() || input.session.cloudShareTrainingId || null,
    cloudShareExperienceId: input.experienceId?.trim() || input.session.cloudShareExperienceId || null,
    cloudShareTeamId: input.teamId?.trim() || input.session.cloudShareTeamId || null,
    admissionClosedAt: input.session.admissionClosedAt ?? null,
    retiredAt: input.session.retiredAt ?? null,
    lastPublishError: input.error,
    lastPublishCorrelationId: input.correlationId,
    updatedAt: now,
  };
  await deps.repository.save(blocked);
  return blocked;
}

export function attachCohortExamSessionInheritedContext(
  exam: Exam,
  session: CohortExamSession,
): CohortExamSessionWithInheritedContext {
  return {
    session,
    inheritedContext: {
      project: { id: exam.projectId, name: exam.projectName },
      blueprint: { id: exam.blueprintId, name: exam.blueprintName },
      snapshot: { id: exam.snapshotId, name: exam.snapshotName },
      policy: { id: exam.policyId, name: exam.policyName },
      allowedRegions: exam.allowedRegions,
      instructor: { id: exam.instructorId, name: exam.instructorName },
      scoreRetrievalEnabled: exam.scoreRetrievalEnabled,
      timeLimitMinutes: exam.timeLimitMinutes,
    },
  };
}

export async function closeCohortExamSessionAdmission(
  deps: {
    readonly repository: CohortExamSessionRepository;
    readonly now?: () => Date;
  },
  input: {
    readonly session: CohortExamSession;
  },
): Promise<CohortExamSession> {
  if (input.session.status !== "published") {
    throw new CohortExamSessionValidationError("Only published Cohort Exam Sessions can close admission.");
  }
  const now = (deps.now ?? (() => new Date()))();
  const closed: CohortExamSession = {
    ...input.session,
    status: "closed",
    admissionClosedAt: now,
    updatedAt: now,
  };
  await deps.repository.save(closed);
  return closed;
}

export async function retireCohortExamSession(
  deps: {
    readonly repository: CohortExamSessionRepository;
    readonly now?: () => Date;
  },
  input: {
    readonly session: CohortExamSession;
  },
): Promise<CohortExamSession> {
  if (input.session.status !== "published" && input.session.status !== "closed") {
    throw new CohortExamSessionValidationError("Only published or closed Cohort Exam Sessions can be retired.");
  }
  const now = (deps.now ?? (() => new Date()))();
  const retired: CohortExamSession = {
    ...input.session,
    status: "retired",
    admissionClosedAt: input.session.admissionClosedAt ?? now,
    retiredAt: now,
    updatedAt: now,
  };
  await deps.repository.save(retired);
  return retired;
}

function validateDraftSessionInput(input: {
  readonly customerId: string;
  readonly examId: string;
  readonly name: string;
  readonly admissionStartsAt: Date;
  readonly admissionEndsAt?: Date | null;
  readonly capacity?: number | null;
}): void {
  if (!input.customerId.trim() || !input.examId.trim() || !input.name.trim()) {
    throw new CohortExamSessionValidationError("Draft Cohort Exam Sessions require a name and parent Exam.");
  }
  if (Number.isNaN(input.admissionStartsAt.getTime())) {
    throw new CohortExamSessionValidationError("admissionStartsAt must be a valid timestamp.");
  }
  if (input.admissionEndsAt && Number.isNaN(input.admissionEndsAt.getTime())) {
    throw new CohortExamSessionValidationError("admissionEndsAt must be a valid timestamp.");
  }
  if (input.admissionEndsAt && input.admissionEndsAt.getTime() <= input.admissionStartsAt.getTime()) {
    throw new CohortExamSessionValidationError("admissionEndsAt must be after admissionStartsAt.");
  }
  if (
    input.capacity !== null &&
    input.capacity !== undefined &&
    (!Number.isInteger(input.capacity) || input.capacity <= 0)
  ) {
    throw new CohortExamSessionValidationError("capacity must be a positive integer when provided.");
  }
}
