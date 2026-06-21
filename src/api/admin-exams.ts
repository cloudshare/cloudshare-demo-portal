import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import {
  CloudShareError,
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
  type CloudShareClient,
} from "@/integrations/cloudshare";
import {
  createCloudShareExamAuthoringSource,
  type CloudShareExamAuthoringSource,
} from "@/integrations/cloudshare/resources";
import type { Logger } from "@/observability/logger";
import { randomUUID } from "node:crypto";
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
  publishExam,
  unpublishExam,
  updateDraftExam,
  type CreateDraftExamInput,
  type Exam,
  type ExamRepository,
  type UpdateDraftExamInput,
} from "@/domain/exam-catalog";
import type { ExamAuthoringCacheRepository } from "@/persistence/exam-authoring-cache-repository";

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

interface AdminExamPublishDeps {
  readonly repository: ExamRepository;
  readonly connections: CloudShareConnectionRepository;
  readonly cloudshare: CloudShareClientFactory;
  readonly cache: ExamAuthoringCacheRepository;
  readonly diagnostics?: DiagnosticRecorder;
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly newCorrelationId?: () => string;
}

const DEFAULT_INSTRUCTOR_ID = "seeded-cloudshare-instructor";
const DEFAULT_INSTRUCTOR_NAME = "Seeded CloudShare Instructor";

export async function handleGetExamAuthoringBootstrap(
  deps: AdminExamAuthoringDeps,
  request: ResourceRequest,
): Promise<AdminExamResponse> {
  const connection = await deps.connections.findByCustomerId(request.customerId);
  if (!connection) {
    return { status: 404, body: { error: "Save a CloudShare Connection before building Exams." } };
  }

  if (!request.refresh) {
    const cached = await deps.cache.getBootstrap(request.customerId);
    if (cached) {
      return { status: 200, body: { source: "cache", ...cached } };
    }
  }

  const source = resolveAuthoringSource(deps.cloudshare, connection);
  let projects;
  try {
    projects = await source.listProjects();
    await recordResourceRead(deps, {
      customerId: request.customerId,
      operation: "cloudshare.resource_sync.projects.read",
      integrationSurface: "cloudshare.v3.projects",
      path: "/projects",
      resourceType: "project",
      response: {
        itemCount: projects.length,
        resourceIds: projects.map((project) => project.id),
      },
    });
  } catch (error) {
    return await handleCloudShareFailure(deps, {
      customerId: request.customerId,
      operation: "cloudshare.resource_sync.projects.read",
      integrationSurface: "cloudshare.v3.projects",
      path: "/projects",
      resourceType: "project",
      error,
    });
  }

  let regions;
  try {
    regions = await source.listRegions();
    await recordResourceRead(deps, {
      customerId: request.customerId,
      operation: "cloudshare.resource_sync.regions.read",
      integrationSurface: "cloudshare.v3.regions",
      path: "/regions",
      resourceType: "region",
      response: {
        itemCount: regions.length,
        resourceIds: regions.map((region) => region.id),
      },
    });
  } catch (error) {
    return await handleCloudShareFailure(deps, {
      customerId: request.customerId,
      operation: "cloudshare.resource_sync.regions.read",
      integrationSurface: "cloudshare.v3.regions",
      path: "/regions",
      resourceType: "region",
      error,
    });
  }

  await deps.cache.saveBootstrap(request.customerId, { projects, regions });
  return { status: 200, body: { source: "live", projects, regions } };
}

export async function handleGetProjectResources(
  deps: AdminExamAuthoringDeps,
  request: ProjectRequest,
): Promise<AdminExamResponse> {
  if (!request.projectId.trim()) {
    return { status: 400, body: { error: "projectId is required" } };
  }

  const connection = await deps.connections.findByCustomerId(request.customerId);
  if (!connection) {
    return { status: 404, body: { error: "Save a CloudShare Connection before building Exams." } };
  }

  if (!request.refresh) {
    const cached = await deps.cache.getProjectResources(request.customerId, request.projectId);
    if (cached) {
      return {
        status: 200,
        body: { source: "cache", projectId: request.projectId, ...cached },
      };
    }
  }

  const source = resolveAuthoringSource(deps.cloudshare, connection);
  let blueprints;
  try {
    blueprints = await source.listProjectBlueprints(request.projectId);
    await recordResourceRead(deps, {
      customerId: request.customerId,
      operation: "cloudshare.resource_sync.blueprints.read",
      integrationSurface: "cloudshare.v3.projects.blueprints",
      path: `/projects/${request.projectId}/blueprints`,
      resourceType: "blueprint",
      resourceIds: { projectId: request.projectId },
      response: {
        itemCount: blueprints.length,
        resourceIds: blueprints.map((blueprint) => blueprint.id),
      },
    });
  } catch (error) {
    return await handleCloudShareFailure(deps, {
      customerId: request.customerId,
      operation: "cloudshare.resource_sync.blueprints.read",
      integrationSurface: "cloudshare.v3.projects.blueprints",
      path: `/projects/${request.projectId}/blueprints`,
      resourceType: "blueprint",
      resourceIds: { projectId: request.projectId },
      error,
    });
  }

  let policies;
  try {
    policies = await source.listProjectPolicies(request.projectId);
    await recordResourceRead(deps, {
      customerId: request.customerId,
      operation: "cloudshare.resource_sync.policies.read",
      integrationSurface: "cloudshare.v3.projects.policies",
      path: `/projects/${request.projectId}/policies`,
      resourceType: "policy",
      resourceIds: { projectId: request.projectId },
      response: {
        itemCount: policies.length,
        resourceIds: policies.map((policy) => policy.id),
      },
    });
  } catch (error) {
    return await handleCloudShareFailure(deps, {
      customerId: request.customerId,
      operation: "cloudshare.resource_sync.policies.read",
      integrationSurface: "cloudshare.v3.projects.policies",
      path: `/projects/${request.projectId}/policies`,
      resourceType: "policy",
      resourceIds: { projectId: request.projectId },
      error,
    });
  }

  await deps.cache.saveProjectResources(request.customerId, request.projectId, {
    blueprints,
    policies,
  });
  return {
    status: 200,
    body: { source: "live", projectId: request.projectId, blueprints, policies },
  };
}

export async function handleGetBlueprintDetail(
  deps: AdminExamAuthoringDeps,
  request: BlueprintRequest,
): Promise<AdminExamResponse> {
  if (!request.projectId.trim() || !request.blueprintId.trim()) {
    return { status: 400, body: { error: "projectId and blueprintId are required" } };
  }

  const connection = await deps.connections.findByCustomerId(request.customerId);
  if (!connection) {
    return { status: 404, body: { error: "Save a CloudShare Connection before building Exams." } };
  }

  if (!request.refresh) {
    const cached = await deps.cache.getBlueprintDetail(
      request.customerId,
      request.projectId,
      request.blueprintId,
    );
    if (cached) {
      return {
        status: 200,
        body: { source: "cache", projectId: request.projectId, blueprint: cached },
      };
    }
  }

  const source = resolveAuthoringSource(deps.cloudshare, connection);
  try {
    const blueprint = await source.getBlueprintDetail(request.projectId, request.blueprintId);
    const blueprintForClient = stripBlueprintDiagnosticSummary(blueprint);
    await recordResourceRead(deps, {
      customerId: request.customerId,
      operation: "cloudshare.resource_sync.blueprint_detail.read",
      integrationSurface: "cloudshare.v3.projects.blueprint_detail",
      path: `/projects/${request.projectId}/blueprints/${request.blueprintId}`,
      resourceType: "blueprint_detail",
      resourceIds: { projectId: request.projectId, blueprintId: request.blueprintId },
      response: buildBlueprintDetailDiagnosticResponse(blueprint),
    });
    await deps.cache.saveBlueprintDetail(
      request.customerId,
      request.projectId,
      request.blueprintId,
      blueprintForClient,
    );
    return {
      status: 200,
      body: { source: "live", projectId: request.projectId, blueprint: blueprintForClient },
    };
  } catch (error) {
    return await handleCloudShareFailure(deps, {
      customerId: request.customerId,
      operation: "cloudshare.resource_sync.blueprint_detail.read",
      integrationSurface: "cloudshare.v3.projects.blueprint_detail",
      path: `/projects/${request.projectId}/blueprints/${request.blueprintId}`,
      resourceType: "blueprint_detail",
      resourceIds: { projectId: request.projectId, blueprintId: request.blueprintId },
      error,
    });
  }
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
  try {
    const existing = await deps.repository.findById(request.examId);
    if (!existing || existing.customerId !== request.customerId) {
      return { status: 404, body: { error: `Exam ${request.examId} was not found for customer ${request.customerId}` } };
    }

    const publishability = await validateCurrentDefaultSnapshotRegions(deps, existing);
    if (publishability) {
      return publishability;
    }

    const exam = await publishExam(
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
      operation: "exam.publish",
      outcome: "success",
      message: "Exam published",
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

async function validateCurrentDefaultSnapshotRegions(
  deps: AdminExamPublishDeps,
  exam: Exam,
): Promise<AdminExamResponse | null> {
  if (exam.allowedRegions.length === 0) {
    return {
      status: 400,
      body: { error: "Select at least one allowed Region from the Blueprint default Snapshot." },
    };
  }

  const connection = await deps.connections.findByCustomerId(exam.customerId);
  if (!connection) {
    return { status: 404, body: { error: "Save a CloudShare Connection before publishing Exams." } };
  }

  const source = resolveAuthoringSource(deps.cloudshare, connection);
  let blueprint;
  try {
    blueprint = await source.getBlueprintDetail(exam.projectId, exam.blueprintId);
    await recordResourceRead(deps, {
      customerId: exam.customerId,
      operation: "cloudshare.resource_sync.blueprint_detail.read",
      integrationSurface: "cloudshare.v3.projects.blueprint_detail",
      path: `/projects/${exam.projectId}/blueprints/${exam.blueprintId}`,
      resourceType: "blueprint_detail",
      resourceIds: { projectId: exam.projectId, blueprintId: exam.blueprintId },
      response: buildBlueprintDetailDiagnosticResponse(blueprint),
    });
  } catch (error) {
    return await handleCloudShareFailure(deps, {
      customerId: exam.customerId,
      operation: "cloudshare.resource_sync.blueprint_detail.read",
      integrationSurface: "cloudshare.v3.projects.blueprint_detail",
      path: `/projects/${exam.projectId}/blueprints/${exam.blueprintId}`,
      resourceType: "blueprint_detail",
      resourceIds: { projectId: exam.projectId, blueprintId: exam.blueprintId },
      error,
    });
  }

  await deps.cache.saveBlueprintDetail(exam.customerId, exam.projectId, exam.blueprintId, blueprint);

  if (blueprint.defaultSnapshotId === null || blueprint.defaultSnapshotId !== exam.snapshotId) {
    return {
      status: 400,
      body: {
        error:
          "The selected Blueprint default Snapshot has changed. Refresh CloudShare authoring resources and reselect the Exam provisioning tuple.",
      },
    };
  }

  const defaultSnapshot = blueprint.snapshots.find((snapshot) => snapshot.id === blueprint.defaultSnapshotId);
  if (!defaultSnapshot) {
    return {
      status: 400,
      body: {
        error:
          "The selected Blueprint default Snapshot could not be found. Refresh CloudShare authoring resources and reselect the Exam provisioning tuple.",
      },
    };
  }

  if (defaultSnapshot.regionIds.length === 0) {
    return {
      status: 400,
      body: { error: "The selected Blueprint default Snapshot is not deployed to any Regions yet." },
    };
  }

  const defaultSnapshotRegionIds = new Set(defaultSnapshot.regionIds);
  const unsupportedRegions = exam.allowedRegions.filter((region) => !defaultSnapshotRegionIds.has(region.id));
  if (unsupportedRegions.length > 0) {
    return {
      status: 400,
      body: {
        error:
          "Selected allowed Regions are no longer deployed for the Blueprint default Snapshot. Refresh CloudShare authoring resources and reselect supported Regions.",
      },
    };
  }

  return null;
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

function resolveAuthoringSource(
  factory: CloudShareClientFactory,
  connection: Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>> extends infer T
    ? Exclude<T, null>
    : never,
): CloudShareExamAuthoringSource {
  const candidate = factory.forConnection(connection) as unknown;
  if (
    typeof candidate === "object" &&
    candidate !== null &&
    "listProjects" in candidate &&
    typeof (candidate as CloudShareExamAuthoringSource).listProjects === "function"
  ) {
    return candidate as CloudShareExamAuthoringSource;
  }
  return createCloudShareExamAuthoringSource(candidate as CloudShareClient);
}

interface ResourceDiagnosticFailureSpec {
  readonly customerId: string;
  readonly operation: string;
  readonly integrationSurface: string;
  readonly path: string;
  readonly resourceType: string;
  readonly resourceIds?: Record<string, string>;
  readonly error: unknown;
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

async function recordResourceRead(
  deps: Pick<AdminExamAuthoringDeps, "diagnostics" | "logger">,
  spec: {
    readonly customerId: string;
    readonly operation: string;
    readonly integrationSurface: string;
    readonly path: string;
    readonly resourceType: string;
    readonly resourceIds?: Record<string, string>;
    readonly response: Record<string, unknown>;
  },
): Promise<void> {
  await safeRecordDiagnostic(deps, {
    source: "admin-exams",
    customerId: spec.customerId,
    level: "info",
    operation: spec.operation,
    outcome: "success",
    message: `${spec.resourceType} resource read succeeded`,
    request: { method: "GET", path: spec.path },
    response: spec.response,
    details: { integrationSurface: spec.integrationSurface },
    externalIds: { resourceType: spec.resourceType, ...(spec.resourceIds ?? {}) },
  });
}

function buildBlueprintDetailDiagnosticResponse(blueprint: {
  readonly id: string;
  readonly defaultSnapshotId: string | null;
  readonly snapshots: ReadonlyArray<unknown>;
  readonly diagnosticSummary?: Record<string, unknown>;
}): Record<string, unknown> {
  return (
    blueprint.diagnosticSummary ?? {
      blueprintId: blueprint.id,
      defaultSnapshotId: blueprint.defaultSnapshotId,
      snapshotCount: blueprint.snapshots.length,
    }
  );
}

function stripBlueprintDiagnosticSummary<T extends { readonly diagnosticSummary?: Record<string, unknown> }>(
  blueprint: T,
): Omit<T, "diagnosticSummary"> {
  const { diagnosticSummary: _diagnosticSummary, ...rest } = blueprint;
  return rest;
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

async function handleCloudShareFailure(
  deps: Pick<AdminExamAuthoringDeps, "diagnostics" | "logger" | "now" | "newCorrelationId">,
  spec: ResourceDiagnosticFailureSpec,
): Promise<AdminExamResponse> {
  const cloudShareError = asCloudShareErrorLike(spec.error);
  if (cloudShareError) {
    const diagnostic = buildDiagnostic(
      spec.operation,
      spec.path,
      spec.integrationSurface,
      cloudShareError,
    );
    const correlationId = (deps.newCorrelationId ?? randomUUID)();
    const occurredAt = (deps.now ?? (() => new Date()))().toISOString();
    await safeRecordDiagnostic(deps, {
      source: "admin-exams",
      customerId: spec.customerId,
      level: "warn",
      operation: spec.operation,
      outcome: "failure",
      message: `${spec.resourceType} resource read failed`,
      correlationId,
      request: {
        method: (cloudShareError.context?.method as string | undefined) ?? "GET",
        path: spec.path,
        ...(cloudShareError.context?.requestHeaders
          ? { headers: cloudShareError.context.requestHeaders }
          : {}),
      },
      response: {
        ...(diagnostic.responseStatus !== undefined ? { status: diagnostic.responseStatus } : {}),
      },
      details: {
        integrationSurface: spec.integrationSurface,
        failureMode: diagnostic.failureMode,
      },
      externalIds: { resourceType: spec.resourceType, ...(spec.resourceIds ?? {}) },
    });
    deps.logger.warn("cloudshare exam authoring failed", {
      correlationId,
      occurredAt,
      ...diagnostic,
    });
    return {
      status: 502,
      body: {
        error: "CloudShare resource request failed.",
        correlationId,
        occurredAt,
        diagnostic,
      },
    };
  }

  throw spec.error;
}

function asCloudShareErrorLike(error: unknown): CloudShareError | null {
  if (
    error instanceof CloudShareRequestError ||
    error instanceof CloudShareTransportError ||
    error instanceof CloudShareResponseError ||
    error instanceof CloudShareError
  ) {
    return error;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { name?: unknown }).name === "string" &&
    ((error as { name: string }).name === "CloudShareRequestError" ||
      (error as { name: string }).name === "CloudShareTransportError" ||
      (error as { name: string }).name === "CloudShareResponseError" ||
      (error as { name: string }).name === "CloudShareError")
  ) {
    return error as CloudShareError;
  }

  return null;
}

function buildDiagnostic(
  operation: string,
  path: string,
  integrationSurface: string,
  error: CloudShareError,
): Record<string, unknown> {
  const errorName = error.name;
  const diagnostic: Record<string, unknown> = {
    operation,
    integrationSurface,
    method: (error.context?.method as string | undefined) ?? "GET",
    path,
  };

  if (error instanceof CloudShareRequestError || errorName === "CloudShareRequestError") {
    diagnostic.failureMode = "http_status";
    diagnostic.responseStatus =
      error instanceof CloudShareRequestError ? error.status : error.context?.status;
  } else if (error instanceof CloudShareTransportError || errorName === "CloudShareTransportError") {
    diagnostic.failureMode = "transport";
  } else if (error instanceof CloudShareResponseError || errorName === "CloudShareResponseError") {
    diagnostic.failureMode = "unexpected_response";
  } else {
    diagnostic.failureMode = "cloudshare_error";
  }

  return diagnostic;
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
