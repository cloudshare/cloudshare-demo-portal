import { randomUUID } from "node:crypto";
import type { AuditRepository } from "@/domain/audit-trail";
import type { DiagnosticActor, DiagnosticLogEntryInput, DiagnosticRecorder } from "@/domain/diagnostic-log";
import {
  createDraftExam,
  DraftExamValidationError,
  ExamNotFoundError,
  ExamStateError,
  updateDraftExam,
  type CreateDraftExamInput,
  type Exam,
  type ExamRepository,
  type UpdateDraftExamInput,
} from "@/domain/exam-catalog";
import type { Logger } from "@/observability/logger";
import type { ExamAuthoringCacheRepository } from "@/persistence/exam-authoring-cache-repository";

export interface AdminExamDraftRuntimeDeps {
  readonly repository: ExamRepository;
  readonly cache: ExamAuthoringCacheRepository;
  readonly instructor:
    | {
        readonly id: string;
        readonly name: string;
      }
    | null;
  readonly diagnostics?: DiagnosticRecorder;
  readonly audit?: Pick<AuditRepository, "write">;
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly newAuditId?: () => string;
}

export interface AdminExamDraftRuntimeRequest {
  readonly customerId: string;
  readonly actor?: DiagnosticActor | null;
  readonly body?: unknown;
}

export interface AdminExamDraftUpdateRuntimeRequest extends AdminExamDraftRuntimeRequest {
  readonly examId: string;
}

export interface AdminExamDraftRuntimeResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

const DEFAULT_INSTRUCTOR_ID = "seeded-cloudshare-instructor";
const DEFAULT_INSTRUCTOR_NAME = "Seeded CloudShare Instructor";

export async function createAdminDraftExamRuntime(
  deps: AdminExamDraftRuntimeDeps,
  request: AdminExamDraftRuntimeRequest,
): Promise<AdminExamDraftRuntimeResponse> {
  const instructor = deps.instructor;
  if (!isConfiguredInstructor(instructor)) {
    return {
      status: 400,
      body: {
        error: "Configure the seeded CloudShare instructor before creating Exams for this customer.",
      },
    };
  }

  try {
    const input = await parseCreateDraftExamInput(
      request.customerId,
      request.body,
      deps.cache,
      instructor,
    );
    if (!input) {
      return {
        status: 400,
        body: {
          error: "Refresh CloudShare authoring resources and reselect the Exam provisioning tuple.",
        },
      };
    }

    const exam = await createDraftExam(
      {
        repository: deps.repository,
        now: deps.now,
        newId: deps.newId,
      },
      input,
    );
    await safeRecordDiagnostic(deps, {
      source: "admin-exams",
      customerId: request.customerId,
      actor: request.actor ?? null,
      subject: { type: "exam", id: exam.id },
      examId: exam.id,
      level: "info",
      operation: "exam.create",
      outcome: "success",
      message: "Draft exam created",
      details: {
        changedFields: [
          "title",
          "description",
          "scoreRetrievalEnabled",
          "policyId",
          "openPeriodMinutes",
          "allowedRegions",
          "status",
        ],
      },
    });
    await safeRecordAudit(deps, {
      request,
      action: "exam.created",
      subjectId: exam.id,
      examId: exam.id,
      outcome: "success",
      details: {
        changedFields: [
          "title",
          "description",
          "scoreRetrievalEnabled",
          "policyId",
          "openPeriodMinutes",
          "allowedRegions",
          "status",
        ],
      },
    });
    return { status: 201, body: { exam } };
  } catch (error) {
    if (error instanceof DraftExamValidationError) {
      return { status: 400, body: { error: error.message } };
    }
    throw error;
  }
}

export async function updateAdminDraftExamRuntime(
  deps: Pick<AdminExamDraftRuntimeDeps, "repository" | "cache" | "diagnostics" | "audit" | "logger" | "now" | "newAuditId">,
  request: AdminExamDraftUpdateRuntimeRequest,
): Promise<AdminExamDraftRuntimeResponse> {
  try {
    const existing = await deps.repository.findById(request.examId);
    if (!existing || existing.customerId !== request.customerId) {
      throw new ExamNotFoundError(request.customerId, request.examId);
    }

    const input = await parseUpdateDraftExamInput(
      request.customerId,
      request.examId,
      request.body,
      existing,
      deps.cache,
    );
    if (!input) {
      return {
        status: 400,
        body: {
          error: "Refresh CloudShare authoring resources and reselect the draft Exam Policy and allowed Regions.",
        },
      };
    }

    const exam = await updateDraftExam(
      { repository: deps.repository, now: deps.now },
      input,
    );
    const changedFields = summariseExamChanges(existing, exam);
    await safeRecordDiagnostic(deps, {
      source: "admin-exams",
      customerId: request.customerId,
      actor: request.actor ?? null,
      subject: { type: "exam", id: exam.id },
      examId: exam.id,
      level: "info",
      operation: "exam.update",
      outcome: "success",
      message: "Draft exam updated",
      details: { changedFields },
    });
    await safeRecordAudit(deps, {
      request,
      action: "exam.updated",
      subjectId: exam.id,
      examId: exam.id,
      outcome: "success",
      details: { changedFields },
    });
    return { status: 200, body: { exam } };
  } catch (error) {
    if (error instanceof DraftExamValidationError || error instanceof ExamStateError) {
      return { status: 400, body: { error: error.message } };
    }
    if (error instanceof ExamNotFoundError) {
      return { status: 404, body: { error: error.message } };
    }
    throw error;
  }
}

function isConfiguredInstructor(
  instructor:
    | {
        readonly id: string;
        readonly name: string;
      }
    | null,
): instructor is {
  readonly id: string;
  readonly name: string;
} {
  if (!instructor) {
    return false;
  }
  const id = instructor.id.trim();
  const name = instructor.name.trim();
  if (!id || !name) {
    return false;
  }
  return !(id === DEFAULT_INSTRUCTOR_ID && name === DEFAULT_INSTRUCTOR_NAME);
}

function summariseExamChanges(before: Exam, after: Exam): string[] {
  const changedFields: string[] = [];
  if (before.title !== after.title) changedFields.push("title");
  if (before.description !== after.description) changedFields.push("description");
  if (before.scoreRetrievalEnabled !== after.scoreRetrievalEnabled) {
    changedFields.push("scoreRetrievalEnabled");
  }
  if (before.policyId !== after.policyId) changedFields.push("policyId");
  if (before.policyName !== after.policyName) changedFields.push("policyName");
  if (before.timeLimitMinutes !== after.timeLimitMinutes) changedFields.push("timeLimitMinutes");
  if (before.openPeriodMinutes !== after.openPeriodMinutes) changedFields.push("openPeriodMinutes");
  if (before.storageLeaseMinutes !== after.storageLeaseMinutes) {
    changedFields.push("storageLeaseMinutes");
  }
  if (JSON.stringify(before.allowedRegions) !== JSON.stringify(after.allowedRegions)) {
    changedFields.push("allowedRegions");
  }
  return changedFields;
}

async function safeRecordDiagnostic(
  deps: { readonly diagnostics?: DiagnosticRecorder; readonly logger: Logger },
  entry: DiagnosticLogEntryInput,
): Promise<void> {
  if (!deps.diagnostics) {
    return;
  }

  try {
    await deps.diagnostics.record(entry);
  } catch (error) {
    deps.logger.warn("admin exam diagnostic recording failed", {
      operation: entry.operation,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function safeRecordAudit(
  deps: Pick<AdminExamDraftRuntimeDeps, "audit" | "logger" | "now" | "newAuditId">,
  input: {
    readonly request: AdminExamDraftRuntimeRequest;
    readonly action: string;
    readonly subjectId: string;
    readonly examId: string;
    readonly outcome: "success" | "failure" | "denied";
    readonly details?: Record<string, unknown>;
    readonly error?: string;
  },
): Promise<void> {
  if (!deps.audit) {
    return;
  }

  try {
    await deps.audit.write({
      id: (deps.newAuditId ?? randomUUID)(),
      customerId: input.request.customerId,
      actorType: input.request.actor?.type ?? null,
      actorId: input.request.actor?.id ?? null,
      actorEmail: input.request.actor?.email ?? null,
      action: input.action,
      subjectType: "exam",
      subjectId: input.subjectId,
      outcome: input.outcome,
      examId: input.examId,
      details: input.details ?? null,
      error: input.error ?? null,
      occurredAt: (deps.now ?? (() => new Date()))(),
    });
  } catch (error) {
    deps.logger.warn("admin exam audit recording failed", {
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function parseUpdateDraftExamInput(
  customerId: string,
  examId: string,
  body: unknown,
  existing: Exam,
  cache: ExamAuthoringCacheRepository,
): Promise<UpdateDraftExamInput | null> {
  return parseMutableDraftExamInput(customerId, examId, body, existing, cache);
}

async function parseMutableDraftExamInput(
  customerId: string,
  examId: string,
  body: unknown,
  existing: Exam,
  cache: ExamAuthoringCacheRepository,
): Promise<UpdateDraftExamInput | null> {
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const candidate = body as Record<string, unknown>;
  if (
    typeof candidate.title !== "string" ||
    typeof candidate.description !== "string" ||
    typeof candidate.scoreRetrievalEnabled !== "boolean" ||
    typeof candidate.policyId !== "string" ||
    typeof candidate.openPeriodMinutes !== "number" ||
    !Array.isArray(candidate.allowedRegionIds) ||
    candidate.allowedRegionIds.some((regionId) => typeof regionId !== "string")
  ) {
    return null;
  }

  if (candidate.allowedRegionIds.length === 0) {
    throw new DraftExamValidationError(
      "Select at least one allowed Region from the Blueprint default Snapshot.",
    );
  }

  const bootstrap = await cache.getBootstrap(customerId);
  const projectResources = await cache.getProjectResources(customerId, existing.projectId);
  const blueprintDetail = await cache.getBlueprintDetail(
    customerId,
    existing.projectId,
    existing.blueprintId,
  );
  if (!bootstrap || !projectResources || !blueprintDetail) {
    return null;
  }

  const policy = projectResources.policies.find((item) => item.id === candidate.policyId);
  const snapshot = blueprintDetail.snapshots.find((item) => item.id === existing.snapshotId);
  if (!policy || !snapshot) {
    return null;
  }
  if (blueprintDetail.defaultSnapshotId === null || blueprintDetail.defaultSnapshotId !== existing.snapshotId) {
    throw new DraftExamValidationError(
      "The selected Blueprint default Snapshot has changed. Refresh CloudShare authoring resources and reselect the Exam provisioning tuple.",
    );
  }

  const allowedRegions = candidate.allowedRegionIds.map((regionId) =>
    bootstrap.regions.find((item) => item.id === regionId),
  );
  if (allowedRegions.some((region) => !region)) {
    return null;
  }

  if (snapshot.regionIds.length === 0) {
    throw new DraftExamValidationError(
      "The selected Blueprint default Snapshot is not deployed to any Regions yet.",
    );
  }

  if (candidate.allowedRegionIds.some((regionId) => !snapshot.regionIds.includes(regionId))) {
    throw new DraftExamValidationError(
      "Selected allowed Regions are not deployed for the Blueprint default Snapshot.",
    );
  }
  if (policy.runtimeLeaseMinutes === null || policy.runtimeLeaseMinutes === undefined) {
    return null;
  }
  validateOpenPeriodMinutes(
    candidate.openPeriodMinutes,
    policy.runtimeLeaseMinutes,
    policy.storageLeaseMinutes,
  );

  return {
    customerId,
    examId,
    title: candidate.title,
    description: candidate.description,
    scoreRetrievalEnabled: candidate.scoreRetrievalEnabled,
    timeLimitMinutes: policy.runtimeLeaseMinutes,
    storageLeaseMinutes: policy.storageLeaseMinutes,
    openPeriodMinutes: candidate.openPeriodMinutes,
    allowedRegions: allowedRegions.map((region) => ({
      id: region!.id,
      name: region!.friendlyName?.trim() || region!.name,
    })),
    policyId: candidate.policyId,
    policyName: policy.name,
  };
}

async function parseCreateDraftExamInput(
  customerId: string,
  body: unknown,
  cache: ExamAuthoringCacheRepository,
  instructor: { readonly id: string; readonly name: string },
): Promise<CreateDraftExamInput | null> {
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const candidate = body as Record<string, unknown>;
  if (
    typeof candidate.title !== "string" ||
    typeof candidate.description !== "string" ||
    typeof candidate.scoreRetrievalEnabled !== "boolean" ||
    typeof candidate.projectId !== "string" ||
    typeof candidate.blueprintId !== "string" ||
    typeof candidate.snapshotId !== "string" ||
    typeof candidate.openPeriodMinutes !== "number" ||
    !Array.isArray(candidate.allowedRegionIds) ||
    candidate.allowedRegionIds.some((regionId) => typeof regionId !== "string") ||
    typeof candidate.policyId !== "string"
  ) {
    return null;
  }

  if (candidate.allowedRegionIds.length === 0) {
    throw new DraftExamValidationError(
      "Select at least one allowed Region from the Blueprint default Snapshot.",
    );
  }

  const bootstrap = await cache.getBootstrap(customerId);
  const projectResources = await cache.getProjectResources(customerId, candidate.projectId);
  const blueprintDetail = await cache.getBlueprintDetail(
    customerId,
    candidate.projectId,
    candidate.blueprintId,
  );
  if (!bootstrap || !projectResources || !blueprintDetail) {
    return null;
  }

  const project = bootstrap.projects.find((item) => item.id === candidate.projectId);
  const blueprint = projectResources.blueprints.find((item) => item.id === candidate.blueprintId);
  const policy = projectResources.policies.find((item) => item.id === candidate.policyId);
  const snapshot = blueprintDetail.snapshots.find((item) => item.id === candidate.snapshotId);
  if (!project || !blueprint || !policy || !snapshot) {
    return null;
  }
  if (blueprintDetail.defaultSnapshotId === null || snapshot.id !== blueprintDetail.defaultSnapshotId) {
    return null;
  }

  const allowedRegions = candidate.allowedRegionIds.map((regionId) =>
    bootstrap.regions.find((item) => item.id === regionId),
  );
  if (allowedRegions.some((region) => !region)) {
    return null;
  }

  if (snapshot.regionIds.length === 0) {
    throw new DraftExamValidationError(
      "The selected Blueprint default Snapshot is not deployed to any Regions yet.",
    );
  }

  if (candidate.allowedRegionIds.some((regionId) => !snapshot.regionIds.includes(regionId))) {
    throw new DraftExamValidationError(
      "Selected allowed Regions are not deployed for the Blueprint default Snapshot.",
    );
  }
  if (policy.runtimeLeaseMinutes === null || policy.runtimeLeaseMinutes === undefined) {
    return null;
  }
  validateOpenPeriodMinutes(
    candidate.openPeriodMinutes,
    policy.runtimeLeaseMinutes,
    policy.storageLeaseMinutes,
  );

  return {
    customerId,
    title: candidate.title,
    description: candidate.description,
    timeLimitMinutes: policy.runtimeLeaseMinutes,
    storageLeaseMinutes: policy.storageLeaseMinutes,
    openPeriodMinutes: candidate.openPeriodMinutes,
    scoreRetrievalEnabled: candidate.scoreRetrievalEnabled,
    projectId: candidate.projectId,
    projectName: project.name,
    blueprintId: candidate.blueprintId,
    blueprintName: blueprint.name,
    snapshotId: candidate.snapshotId,
    snapshotName: snapshot.name,
    allowedRegions: allowedRegions.map((region) => ({
      id: region!.id,
      name: region!.friendlyName?.trim() || region!.name,
    })),
    policyId: candidate.policyId,
    policyName: policy.name,
    instructorId: instructor.id,
    instructorName: instructor.name,
  };
}

function validateOpenPeriodMinutes(
  openPeriodMinutes: number,
  timeLimitMinutes: number,
  storageLeaseMinutes: number | null | undefined,
): void {
  if (!Number.isInteger(openPeriodMinutes) || openPeriodMinutes <= 0) {
    throw new DraftExamValidationError("openPeriodMinutes must be a positive integer.");
  }
  if (openPeriodMinutes < timeLimitMinutes) {
    throw new DraftExamValidationError("Open period must be at least the Policy runtime lease.");
  }
  if (storageLeaseMinutes !== null && storageLeaseMinutes !== undefined && openPeriodMinutes > storageLeaseMinutes) {
    throw new DraftExamValidationError("Open period must not exceed the Policy storage lease.");
  }
}
