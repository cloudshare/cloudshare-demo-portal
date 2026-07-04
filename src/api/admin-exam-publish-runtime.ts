import { randomUUID } from "node:crypto";
import type { AuditRepository } from "@/domain/audit-trail";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { DiagnosticActor, DiagnosticLogEntryInput, DiagnosticRecorder } from "@/domain/diagnostic-log";
import {
  ExamNotFoundError,
  publishExam,
  type Exam,
  type ExamRepository,
} from "@/domain/exam-catalog";
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
import type { ExamAuthoringCacheRepository } from "@/persistence/exam-authoring-cache-repository";

export interface AdminExamPublishRuntimeDeps {
  readonly repository: ExamRepository;
  readonly connections: CloudShareConnectionRepository;
  readonly cloudshare: CloudShareClientFactory;
  readonly cache: ExamAuthoringCacheRepository;
  readonly diagnostics?: DiagnosticRecorder;
  readonly audit?: Pick<AuditRepository, "write">;
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly newCorrelationId?: () => string;
  readonly newAuditId?: () => string;
}

export interface AdminExamPublishRuntimeRequest {
  readonly customerId: string;
  readonly actor?: DiagnosticActor | null;
  readonly examId: string;
}

export interface AdminExamPublishRuntimeResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
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

export async function publishAdminExamRuntime(
  deps: AdminExamPublishRuntimeDeps,
  request: AdminExamPublishRuntimeRequest,
): Promise<AdminExamPublishRuntimeResponse> {
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
    await safeRecordAudit(deps, {
      request,
      action: "exam.published",
      subjectId: exam.id,
      examId: exam.id,
      outcome: "success",
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
  deps: AdminExamPublishRuntimeDeps,
  exam: Exam,
): Promise<AdminExamPublishRuntimeResponse | null> {
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

  await deps.cache.saveBlueprintDetail(
    exam.customerId,
    exam.projectId,
    exam.blueprintId,
    stripBlueprintDiagnosticSummary(blueprint),
  );

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
  deps: Pick<AdminExamPublishRuntimeDeps, "diagnostics" | "logger">,
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

async function safeRecordAudit(
  deps: Pick<AdminExamPublishRuntimeDeps, "audit" | "logger" | "now" | "newAuditId">,
  input: {
    readonly request: AdminExamPublishRuntimeRequest;
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

async function handleCloudShareFailure(
  deps: Pick<AdminExamPublishRuntimeDeps, "diagnostics" | "logger" | "now" | "newCorrelationId">,
  spec: ResourceDiagnosticFailureSpec,
): Promise<AdminExamPublishRuntimeResponse> {
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
