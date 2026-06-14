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
import {
  createDraftExam,
  DraftExamValidationError,
  ExamNotFoundError,
  ExamStateError,
  publishExam,
  unpublishExam,
  updateDraftExam,
  type CreateDraftExamInput,
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
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly newId?: () => string;
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
  } catch (error) {
    return handleCloudShareFailure(deps, "list_projects", "/projects", error);
  }

  let regions;
  try {
    regions = await source.listRegions();
  } catch (error) {
    return handleCloudShareFailure(deps, "list_regions", "/regions", error);
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
  } catch (error) {
    return handleCloudShareFailure(
      deps,
      "list_project_blueprints",
      `/projects/${request.projectId}/blueprints`,
      error,
    );
  }

  let policies;
  try {
    policies = await source.listProjectPolicies(request.projectId);
  } catch (error) {
    return handleCloudShareFailure(
      deps,
      "list_project_policies",
      `/projects/${request.projectId}/policies`,
      error,
    );
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
    await deps.cache.saveBlueprintDetail(
      request.customerId,
      request.projectId,
      request.blueprintId,
      blueprint,
    );
    return {
      status: 200,
      body: { source: "live", projectId: request.projectId, blueprint },
    };
  } catch (error) {
    return handleCloudShareFailure(
      deps,
      "get_blueprint_detail",
      `/projects/${request.projectId}/blueprints/${request.blueprintId}`,
      error,
    );
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

  try {
    const exam = await createDraftExam(
      {
        repository: deps.repository,
        now: deps.now,
        newId: deps.newId,
      },
      input,
    );
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
  deps: Pick<AdminExamCatalogDeps, "repository" | "logger" | "now">,
  request: CustomerRequest & { readonly examId: string },
): Promise<AdminExamResponse> {
  try {
    const exam = await publishExam(
      { repository: deps.repository, now: deps.now },
      { customerId: request.customerId, examId: request.examId },
    );
    return { status: 200, body: { exam } };
  } catch (error) {
    if (error instanceof ExamNotFoundError) {
      return { status: 404, body: { error: error.message } };
    }
    throw error;
  }
}

export async function handleUpdateDraftExam(
  deps: Pick<AdminExamCatalogDeps, "repository" | "logger" | "now">,
  request: CustomerRequest & { readonly examId: string; readonly body?: unknown },
): Promise<AdminExamResponse> {
  const input = parseUpdateDraftExamInput(request.customerId, request.examId, request.body);
  if (!input) {
    return { status: 400, body: { error: "Provide draft Exam metadata before saving changes." } };
  }

  try {
    const exam = await updateDraftExam(
      { repository: deps.repository, now: deps.now },
      input,
    );
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
  deps: Pick<AdminExamCatalogDeps, "repository" | "logger" | "now">,
  request: CustomerRequest & { readonly examId: string },
): Promise<AdminExamResponse> {
  try {
    const exam = await unpublishExam(
      { repository: deps.repository, now: deps.now },
      { customerId: request.customerId, examId: request.examId },
    );
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

function handleCloudShareFailure(
  deps: Pick<AdminExamAuthoringDeps, "logger" | "now" | "newCorrelationId">,
  operation: string,
  path: string,
  error: unknown,
): AdminExamResponse {
  const cloudShareError = asCloudShareErrorLike(error);
  if (cloudShareError) {
    const diagnostic = buildDiagnostic(operation, path, cloudShareError);
    const correlationId = (deps.newCorrelationId ?? randomUUID)();
    const occurredAt = (deps.now ?? (() => new Date()))().toISOString();
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

  throw error;
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
  error: CloudShareError,
): Record<string, unknown> {
  const errorName = error.name;
  const diagnostic: Record<string, unknown> = {
    operation,
    integrationSurface: inferIntegrationSurface(path),
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

function inferIntegrationSurface(path: string): string {
  if (path.includes("/policies")) {
    return "cloudshare.v3.projects.policies";
  }
  if (path.includes("/blueprints/") && path.split("/").length >= 5) {
    return "cloudshare.v3.projects.blueprint_detail";
  }
  if (path.includes("/blueprints")) {
    return "cloudshare.v3.projects.blueprints";
  }
  if (path === "/projects") {
    return "cloudshare.v3.projects";
  }
  if (path === "/regions") {
    return "cloudshare.v3.regions";
  }
  return "cloudshare.v3";
}

function parseUpdateDraftExamInput(
  customerId: string,
  examId: string,
  body: unknown,
): UpdateDraftExamInput | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const candidate = body as Record<string, unknown>;
  if (
    typeof candidate.title !== "string" ||
    typeof candidate.description !== "string" ||
    typeof candidate.scoreRetrievalEnabled !== "boolean"
  ) {
    return null;
  }

  return {
    customerId,
    examId,
    title: candidate.title,
    description: candidate.description,
    scoreRetrievalEnabled: candidate.scoreRetrievalEnabled,
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
    typeof candidate.regionId !== "string" ||
    typeof candidate.policyId !== "string"
  ) {
    return null;
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
  const region = bootstrap.regions.find((item) => item.id === candidate.regionId);
  const blueprint = projectResources.blueprints.find((item) => item.id === candidate.blueprintId);
  const policy = projectResources.policies.find((item) => item.id === candidate.policyId);
  const snapshot = blueprintDetail.snapshots.find((item) => item.id === candidate.snapshotId);
  if (!project || !region || !blueprint || !policy || !snapshot) {
    return null;
  }
  if (blueprintDetail.defaultSnapshotId === null || snapshot.id !== blueprintDetail.defaultSnapshotId) {
    return null;
  }
  if (snapshot.regionIds.length > 0 && !snapshot.regionIds.includes(candidate.regionId)) {
    return null;
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
    regionId: candidate.regionId,
    regionName: region.friendlyName?.trim() || region.name,
    policyId: candidate.policyId,
    policyName: policy.name,
    instructorId: instructor.id,
    instructorName: instructor.name,
  };
}
