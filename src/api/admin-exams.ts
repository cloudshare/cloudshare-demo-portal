import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { Logger } from "@/observability/logger";
import type {
  DiagnosticActor,
  DiagnosticLogEntryInput,
  DiagnosticRecorder,
} from "@/domain/diagnostic-log";
import {
  createDraftExam,
  DraftExamValidationError,
  ExamNotFoundError,
  ExamStateError,
  unpublishExam,
  updateDraftExam,
  type CreateDraftExamInput,
  type Exam,
  type ExamRepository,
  type UpdateDraftExamInput,
} from "@/domain/exam-catalog";
import type { ExamAuthoringCacheRepository } from "@/persistence/exam-authoring-cache-repository";
import {
  getBlueprintDetailRuntime,
  getExamAuthoringBootstrapRuntime,
  getProjectResourcesRuntime,
} from "./admin-exam-authoring-runtime";
import {
  publishAdminExamRuntime,
  type AdminExamPublishRuntimeDeps,
} from "./admin-exam-publish-runtime";

interface AdminExamResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

interface CustomerRequest {
  readonly customerId: string;
  readonly actor?: DiagnosticActor | null;
}

interface ResourceRequest extends CustomerRequest {
  readonly refresh: boolean;
}

interface ProjectRequest extends ResourceRequest {
  readonly projectId: string;
}

interface BlueprintRequest extends ProjectRequest {
  readonly blueprintId: string;
}

interface AdminExamAuthoringDeps {
  readonly connections: CloudShareConnectionRepository;
  readonly cloudshare: CloudShareClientFactory;
  readonly cache: ExamAuthoringCacheRepository;
  readonly diagnostics?: DiagnosticRecorder;
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly newCorrelationId?: () => string;
}

interface AdminExamCatalogDeps {
  readonly repository: ExamRepository;
  readonly cache: ExamAuthoringCacheRepository;
  readonly instructor:
    | {
        readonly id: string;
        readonly name: string;
      }
    | null;
  readonly diagnostics?: DiagnosticRecorder;
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

type AdminExamPublishDeps = AdminExamPublishRuntimeDeps;

const DEFAULT_INSTRUCTOR_ID = "seeded-cloudshare-instructor";
const DEFAULT_INSTRUCTOR_NAME = "Seeded CloudShare Instructor";

export async function handleGetExamAuthoringBootstrap(
  deps: AdminExamAuthoringDeps,
  request: ResourceRequest,
): Promise<AdminExamResponse> {
  return getExamAuthoringBootstrapRuntime(deps, request);
}

export async function handleGetProjectResources(
  deps: AdminExamAuthoringDeps,
  request: ProjectRequest,
): Promise<AdminExamResponse> {
  return getProjectResourcesRuntime(deps, request);
}

export async function handleGetBlueprintDetail(
  deps: AdminExamAuthoringDeps,
  request: BlueprintRequest,
): Promise<AdminExamResponse> {
  return getBlueprintDetailRuntime(deps, request);
}

export async function handleGetExamCatalog(
  deps: Pick<AdminExamCatalogDeps, "repository" | "logger">,
  request: CustomerRequest,
): Promise<AdminExamResponse> {
  const exams = await deps.repository.listByCustomerId(request.customerId);
  return { status: 200, body: { exams } };
}

export async function handleCreateDraftExam(
  deps: AdminExamCatalogDeps,
  request: CustomerRequest & { readonly body?: unknown },
): Promise<AdminExamResponse> {
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

export async function handlePublishExam(
  deps: AdminExamPublishDeps,
  request: CustomerRequest & { readonly examId: string },
): Promise<AdminExamResponse> {
  return publishAdminExamRuntime(deps, request);
}

export async function handleUpdateDraftExam(
  deps: Pick<AdminExamCatalogDeps, "repository" | "cache" | "diagnostics" | "logger" | "now">,
  request: CustomerRequest & { readonly examId: string; readonly body?: unknown },
): Promise<AdminExamResponse> {
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
      return { status: 400, body: { error: "Refresh CloudShare authoring resources and reselect the draft Exam Policy and allowed Regions." } };
    }

    const exam = await updateDraftExam(
      { repository: deps.repository, now: deps.now },
      input,
    );
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
      details: { changedFields: summariseExamChanges(existing, exam) },
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

export async function handleUnpublishExam(
  deps: Pick<AdminExamCatalogDeps, "repository" | "diagnostics" | "logger" | "now">,
  request: CustomerRequest & { readonly examId: string },
): Promise<AdminExamResponse> {
  try {
    const exam = await unpublishExam(
      { repository: deps.repository, now: deps.now },
      { customerId: request.customerId, examId: request.examId },
    );
    await safeRecordDiagnostic(deps, {
      source: "admin-exams",
      customerId: request.customerId,
      actor: request.actor ?? null,
      subject: { type: "exam", id: exam.id },
      examId: exam.id,
      level: "info",
      operation: "exam.unpublish",
      outcome: "success",
      message: "Exam unpublished",
      details: { changedFields: ["status", "publishedAt"] },
    });
    return { status: 200, body: { exam } };
  } catch (error) {
    if (error instanceof ExamNotFoundError) {
      return { status: 404, body: { error: error.message } };
    }
    throw error;
  }
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

  return {
    customerId,
    examId,
    title: candidate.title,
    description: candidate.description,
    scoreRetrievalEnabled: candidate.scoreRetrievalEnabled,
    timeLimitMinutes: policy.runtimeLeaseMinutes,
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

  return {
    customerId,
    title: candidate.title,
    description: candidate.description,
    timeLimitMinutes: policy.runtimeLeaseMinutes,
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
