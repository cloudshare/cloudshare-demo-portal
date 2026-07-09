import { randomUUID } from "node:crypto";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { DiagnosticLogEntryInput, DiagnosticRecorder } from "@/domain/diagnostic-log";
import {
  CloudShareError,
  CloudShareRateLimitError,
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
  isCloudShareRateLimitError,
  type CloudShareClient,
} from "@/integrations/cloudshare";
import {
  createCloudShareExamAuthoringSource,
  type CloudShareExamAuthoringSource,
} from "@/integrations/cloudshare/resources";
import type { Logger } from "@/observability/logger";
import type { ExamAuthoringCacheRepository } from "@/persistence/exam-authoring-cache-repository";

export interface AdminExamAuthoringRuntimeDeps {
  readonly connections: CloudShareConnectionRepository;
  readonly cloudshare: CloudShareClientFactory;
  readonly cache: ExamAuthoringCacheRepository;
  readonly diagnostics?: DiagnosticRecorder;
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly newCorrelationId?: () => string;
}

export interface AdminExamAuthoringRuntimeResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export interface AdminExamAuthoringResourceRequest {
  readonly customerId: string;
  readonly refresh: boolean;
}

export interface AdminExamAuthoringProjectRequest extends AdminExamAuthoringResourceRequest {
  readonly projectId: string;
}

export interface AdminExamAuthoringBlueprintRequest extends AdminExamAuthoringProjectRequest {
  readonly blueprintId: string;
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

export async function getExamAuthoringBootstrapRuntime(
  deps: AdminExamAuthoringRuntimeDeps,
  request: AdminExamAuthoringResourceRequest,
): Promise<AdminExamAuthoringRuntimeResponse> {
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

export async function getProjectResourcesRuntime(
  deps: AdminExamAuthoringRuntimeDeps,
  request: AdminExamAuthoringProjectRequest,
): Promise<AdminExamAuthoringRuntimeResponse> {
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
    await Promise.all(
      policies.map((policy) =>
        recordResourceRead(deps, {
          customerId: request.customerId,
          operation: "cloudshare.resource_sync.policy_detail.read",
          integrationSurface: "cloudshare.v3.projects.policy_detail",
          path: `/projects/${request.projectId}/policies/${policy.id}`,
          resourceType: "policy_detail",
          resourceIds: { projectId: request.projectId, policyId: policy.id },
          request: buildPolicyDetailDiagnosticRequest(
            policy,
            `/projects/${request.projectId}/policies/${policy.id}`,
          ),
          response: buildPolicyDetailDiagnosticResponse(policy),
        }),
      ),
    );
  } catch (error) {
    return await handleCloudShareFailure(
      deps,
      buildPolicyReadFailureSpec(request.customerId, request.projectId, error),
    );
  }

  const policiesForClient = policies.map(stripPolicyDiagnosticExchange);
  await deps.cache.saveProjectResources(request.customerId, request.projectId, {
    blueprints,
    policies: policiesForClient,
  });
  return {
    status: 200,
    body: {
      source: "live",
      projectId: request.projectId,
      blueprints,
      policies: policiesForClient,
    },
  };
}

export async function getBlueprintDetailRuntime(
  deps: AdminExamAuthoringRuntimeDeps,
  request: AdminExamAuthoringBlueprintRequest,
): Promise<AdminExamAuthoringRuntimeResponse> {
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
        body: {
          source: "cache",
          projectId: request.projectId,
          blueprint: stripBlueprintDiagnosticSummary(cached),
        },
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

async function recordResourceRead(
  deps: Pick<AdminExamAuthoringRuntimeDeps, "diagnostics" | "logger">,
  spec: {
    readonly customerId: string;
    readonly operation: string;
    readonly integrationSurface: string;
    readonly path: string;
    readonly resourceType: string;
    readonly resourceIds?: Record<string, string>;
    readonly request?: Record<string, unknown>;
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
    request: spec.request ?? { method: "GET", path: spec.path },
    response: spec.response,
    details: { integrationSurface: spec.integrationSurface },
    externalIds: { resourceType: spec.resourceType, ...(spec.resourceIds ?? {}) },
  });
}

function buildPolicyDetailDiagnosticResponse(policy: {
  readonly id: string;
  readonly name: string;
  readonly runtimeLeaseMinutes?: number | null;
  readonly storageLeaseMinutes?: number | null;
  readonly diagnosticResponse?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    policyId: policy.id,
    name: policy.name,
    ...(policy.runtimeLeaseMinutes !== undefined
      ? { runtimeLeaseMinutes: policy.runtimeLeaseMinutes }
      : {}),
    ...(policy.storageLeaseMinutes !== undefined
      ? { storageLeaseMinutes: policy.storageLeaseMinutes }
      : {}),
    ...(policy.diagnosticResponse ?? {}),
  };
}

function buildPolicyDetailDiagnosticRequest(
  policy: { readonly diagnosticRequest?: Record<string, unknown> },
  path: string,
): Record<string, unknown> {
  return policy.diagnosticRequest ?? { method: "GET", path };
}

function stripPolicyDiagnosticExchange<
  T extends {
    readonly diagnosticRequest?: Record<string, unknown>;
    readonly diagnosticResponse?: Record<string, unknown>;
  },
>(policy: T): Omit<T, "diagnosticRequest" | "diagnosticResponse"> {
  const {
    diagnosticRequest: _diagnosticRequest,
    diagnosticResponse: _diagnosticResponse,
    ...rest
  } = policy;
  return rest;
}

function buildPolicyReadFailureSpec(
  customerId: string,
  projectId: string,
  error: unknown,
): ResourceDiagnosticFailureSpec {
  const detailFailure = getProjectPolicyDetailFailure(projectId, error);
  if (detailFailure) {
    return {
      customerId,
      operation: "cloudshare.resource_sync.policy_detail.read",
      integrationSurface: "cloudshare.v3.projects.policy_detail",
      path: detailFailure.path,
      resourceType: "policy_detail",
      resourceIds: { projectId, policyId: detailFailure.policyId },
      error,
    };
  }

  return {
    customerId,
    operation: "cloudshare.resource_sync.policies.read",
    integrationSurface: "cloudshare.v3.projects.policies",
    path: `/projects/${projectId}/policies`,
    resourceType: "policy",
    resourceIds: { projectId },
    error,
  };
}

function getProjectPolicyDetailFailure(
  projectId: string,
  error: unknown,
): { path: string; policyId: string } | null {
  const cloudShareError = asCloudShareErrorLike(error);
  const rawPath = cloudShareError?.context?.path;
  if (typeof rawPath !== "string") {
    return null;
  }

  const normalizedPath = rawPath.startsWith("/api/v3/")
    ? rawPath.slice("/api/v3".length)
    : rawPath;
  const pathWithoutQuery = normalizedPath.split(/[?#]/, 1)[0] ?? normalizedPath;
  const prefix = `/projects/${projectId}/policies/`;
  if (!pathWithoutQuery.startsWith(prefix)) {
    return null;
  }

  const policyId = pathWithoutQuery.slice(prefix.length);
  if (!policyId || policyId.includes("/")) {
    return null;
  }

  return { path: pathWithoutQuery, policyId };
}

function buildBlueprintDetailDiagnosticResponse(blueprint: {
  readonly id: string;
  readonly defaultSnapshotId: string | null;
  readonly snapshots: ReadonlyArray<unknown>;
  readonly diagnosticSummary?: Record<string, unknown>;
  readonly diagnosticResponse?: Record<string, unknown>;
}): Record<string, unknown> {
  return blueprint.diagnosticResponse ?? (
    blueprint.diagnosticSummary ?? {
      blueprintId: blueprint.id,
      defaultSnapshotId: blueprint.defaultSnapshotId,
      snapshotCount: blueprint.snapshots.length,
    }
  );
}

function stripBlueprintDiagnosticSummary<
  T extends {
    readonly diagnosticSummary?: Record<string, unknown>;
    readonly diagnosticResponse?: Record<string, unknown>;
  },
>(
  blueprint: T,
): Omit<T, "diagnosticSummary" | "diagnosticResponse"> {
  const {
    diagnosticSummary: _diagnosticSummary,
    diagnosticResponse: _diagnosticResponse,
    ...rest
  } = blueprint;
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
  deps: Pick<AdminExamAuthoringRuntimeDeps, "diagnostics" | "logger" | "now" | "newCorrelationId">,
  spec: ResourceDiagnosticFailureSpec,
): Promise<AdminExamAuthoringRuntimeResponse> {
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
        ...(cloudShareError.context?.requestBody !== undefined
          ? { body: normalizeDiagnosticPayload(cloudShareError.context.requestBody) }
          : {}),
      },
      response: {
        ...(diagnostic.responseStatus !== undefined ? { status: diagnostic.responseStatus } : {}),
        ...(cloudShareError.context?.responseHeaders
          ? { headers: cloudShareError.context.responseHeaders }
          : {}),
        ...(cloudShareError.context?.responseBody !== undefined
          ? { body: normalizeDiagnosticPayload(cloudShareError.context.responseBody) }
          : {}),
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
      status: isCloudShareRateLimitError(spec.error) ? 429 : 502,
      body: {
        error: isCloudShareRateLimitError(spec.error)
          ? "CloudShare is rate limiting resource requests. Wait a moment, then try again."
          : "CloudShare resource request failed.",
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
    error instanceof CloudShareRateLimitError ||
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
    ((error as { name: string }).name === "CloudShareRateLimitError" ||
      (error as { name: string }).name === "CloudShareRequestError" ||
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

  if (isCloudShareRateLimitError(error)) {
    diagnostic.failureMode = "rate_limit";
    diagnostic.responseStatus = error.status;
  } else if (error instanceof CloudShareRequestError || errorName === "CloudShareRequestError") {
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

function normalizeDiagnosticPayload(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
