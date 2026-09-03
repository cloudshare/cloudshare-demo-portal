import type {
  CloudShareClientFactory,
  CloudShareClientObservationOptions,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import { CLOUDSHARE_429_CANDIDATE_MESSAGE } from "@/domain/cloudshare-rate-limit-message";
import type {
  DiagnosticActor,
  DiagnosticRecorder,
  DiagnosticSubject,
} from "@/domain/diagnostic-log";
import {
  CloudShareError,
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
import { certificationCloudShareWorkflow } from "./certification-cloudshare-observer";

const SNAPSHOT_DRIFT_MESSAGE =
  "Exam entry is temporarily unavailable because the lab configuration changed. Contact your administrator.";
const SNAPSHOT_GUARD_RATE_LIMIT_MESSAGE = CLOUDSHARE_429_CANDIDATE_MESSAGE;
const BLUEPRINT_DETAIL_INTEGRATION_SURFACE = "cloudshare.v3.projects.blueprint_detail";

export interface RuntimeBlueprintSnapshotGuardDeps {
  readonly connections?: CloudShareConnectionRepository;
  readonly cloudshare?: CloudShareClientFactory;
  readonly diagnostics?: DiagnosticRecorder;
  readonly logger: Logger;
}

export interface RuntimeBlueprintSnapshotGuardRequest {
  readonly source: string;
  readonly operation: string;
  readonly correlationId?: string | null;
  readonly customerId: string;
  readonly examId: string;
  readonly examAttemptId?: string | null;
  readonly cohortSessionId?: string | null;
  readonly candidateId?: string | null;
  readonly candidateEmail?: string | null;
  readonly actor?: DiagnosticActor | null;
  readonly subject: DiagnosticSubject;
  readonly projectId: string;
  readonly blueprintId: string;
  readonly savedSnapshotId: string;
  /** Reuse the caller's operation context when the guard precedes more CloudShare work. */
  readonly observation?: CloudShareClientObservationOptions;
}

export interface RuntimeBlueprintSnapshotGuardFailure {
  readonly status: 423 | 429;
  readonly message: string;
  readonly correlationId?: string;
}

export async function guardRuntimeBlueprintSnapshot(
  deps: RuntimeBlueprintSnapshotGuardDeps,
  request: RuntimeBlueprintSnapshotGuardRequest,
): Promise<RuntimeBlueprintSnapshotGuardFailure | null> {
  const path = `/projects/${request.projectId}/blueprints/${request.blueprintId}`;

  if (!deps.connections || !deps.cloudshare) {
    await recordFailure(deps, request, {
      path,
      response: null,
      failureMode: "snapshot_lookup_failed",
      reason: "guard_dependencies_missing",
      currentDefaultSnapshotId: null,
      transport: "Runtime snapshot guard dependencies were not configured.",
    });
    return { status: 423, message: SNAPSHOT_DRIFT_MESSAGE, correlationId: request.correlationId ?? undefined };
  }

  const connection = await deps.connections.findByCustomerId(request.customerId);
  if (!connection) {
    await recordFailure(deps, request, {
      path,
      response: null,
      failureMode: "snapshot_lookup_failed",
      reason: "cloudshare_connection_missing",
      currentDefaultSnapshotId: null,
      transport: "CloudShare connection not found for customer.",
    });
    return { status: 423, message: SNAPSHOT_DRIFT_MESSAGE, correlationId: request.correlationId ?? undefined };
  }

  const source = resolveAuthoringSource(deps.cloudshare, connection, request);

  try {
    const blueprint = await source.getBlueprintDetail(request.projectId, request.blueprintId);
    if (
      blueprint.defaultSnapshotId === null ||
      blueprint.defaultSnapshotId !== request.savedSnapshotId
    ) {
      await recordFailure(deps, request, {
        path,
        response:
          blueprint.diagnosticResponse ??
          blueprint.diagnosticSummary ??
          {
            blueprintId: blueprint.id,
            defaultSnapshotId: blueprint.defaultSnapshotId,
            snapshotCount: blueprint.snapshots.length,
          },
        failureMode: "snapshot_drift",
        reason: "default_snapshot_changed",
        currentDefaultSnapshotId: blueprint.defaultSnapshotId,
      });
      return { status: 423, message: SNAPSHOT_DRIFT_MESSAGE, correlationId: request.correlationId ?? undefined };
    }
  } catch (error) {
    const cloudShareError = asCloudShareErrorLike(error);
    const rateLimited = isCloudShareRateLimitError(error);
    const response =
      cloudShareError?.context?.status !== undefined ||
      cloudShareError?.context?.responseHeaders ||
      cloudShareError?.context?.responseBody !== undefined
        ? {
            ...(cloudShareError.context?.status !== undefined
              ? { status: cloudShareError.context.status as number }
              : {}),
            ...(cloudShareError.context?.responseHeaders
              ? { headers: cloudShareError.context.responseHeaders }
              : {}),
            ...(cloudShareError.context?.responseBody !== undefined
              ? { body: normalizeDiagnosticPayload(cloudShareError.context.responseBody) }
              : {}),
          }
        : null;
    await recordFailure(deps, request, {
      path: (cloudShareError?.context?.path as string | undefined) ?? path,
      response,
      failureMode: rateLimited ? "snapshot_guard_unavailable" : "snapshot_lookup_failed",
      reason: "blueprint_detail_lookup_failed",
      currentDefaultSnapshotId: null,
      transport: error instanceof Error ? error.message : String(error),
      integrationFailureMode: inferIntegrationFailureMode(error),
      requestHeaders: cloudShareError?.context?.requestHeaders as Record<string, unknown> | undefined,
      requestBody: normalizeDiagnosticPayload(cloudShareError?.context?.requestBody),
    });
    return {
      status: rateLimited ? 429 : 423,
      message: rateLimited ? SNAPSHOT_GUARD_RATE_LIMIT_MESSAGE : SNAPSHOT_DRIFT_MESSAGE,
      correlationId: request.correlationId ?? undefined,
    };
  }

  return null;
}

function resolveAuthoringSource(
  factory: CloudShareClientFactory,
  connection: NonNullable<Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>>,
  request: RuntimeBlueprintSnapshotGuardRequest,
): CloudShareExamAuthoringSource {
  const candidate = factory.forConnection(connection, request.observation ?? certificationCloudShareWorkflow({
    actor: request.actor,
    customerId: request.customerId,
    subject: request.subject,
    correlationId: request.correlationId ?? `snapshot-guard:${request.operation}:${request.examAttemptId ?? request.cohortSessionId ?? request.examId}`,
    source: request.source,
    examId: request.examId,
    examAttemptId: request.examAttemptId ?? undefined,
    candidateEmail: request.candidateEmail ?? undefined,
    externalIds: { projectId: request.projectId, blueprintId: request.blueprintId },
  })) as unknown;
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

function inferIntegrationFailureMode(error: unknown): string {
  if (isCloudShareRateLimitError(error)) {
    return "rate_limit";
  }
  if (error instanceof CloudShareRequestError || (error as { name?: unknown })?.name === "CloudShareRequestError") {
    return "http_status";
  }
  if (error instanceof CloudShareTransportError || (error as { name?: unknown })?.name === "CloudShareTransportError") {
    return "transport";
  }
  if (error instanceof CloudShareResponseError || (error as { name?: unknown })?.name === "CloudShareResponseError") {
    return "unexpected_response";
  }
  return "unknown";
}

async function recordFailure(
  deps: RuntimeBlueprintSnapshotGuardDeps,
  request: RuntimeBlueprintSnapshotGuardRequest,
  failure: {
    readonly path: string;
    readonly response: Record<string, unknown> | null;
    readonly failureMode: "snapshot_drift" | "snapshot_lookup_failed" | "snapshot_guard_unavailable";
    readonly reason: string;
    readonly currentDefaultSnapshotId: string | null;
    readonly transport?: string;
    readonly integrationFailureMode?: string;
    readonly requestHeaders?: Record<string, unknown>;
    readonly requestBody?: unknown;
  },
): Promise<void> {
  await deps.diagnostics?.record({
    source: request.source,
    customerId: request.customerId,
    candidateEmail: request.candidateEmail ?? null,
    examId: request.examId,
    examAttemptId: request.examAttemptId ?? null,
    correlationId: request.correlationId ?? null,
    actor:
      request.actor ??
      (request.candidateId
        ? {
            type: "candidate",
            id: request.candidateId,
            email: request.candidateEmail ?? null,
          }
        : null),
    subject: request.subject,
    level: "warn",
    operation: request.operation,
    outcome: "failure",
    message: "CloudShare Blueprint default Snapshot guard blocked candidate runtime entry",
    request: {
      method: "GET",
      path: failure.path,
      ...(failure.requestHeaders ? { headers: failure.requestHeaders } : {}),
      ...(failure.requestBody !== undefined ? { body: failure.requestBody } : {}),
    },
    ...(failure.response ? { response: failure.response } : {}),
    externalIds: {
      projectId: request.projectId,
      blueprintId: request.blueprintId,
      savedSnapshotId: request.savedSnapshotId,
      ...(request.cohortSessionId ? { cohortSessionId: request.cohortSessionId } : {}),
    },
    details: {
      attemptedOperation: "validate_blueprint_default_snapshot",
      integrationSurface: BLUEPRINT_DETAIL_INTEGRATION_SURFACE,
      failureMode: failure.failureMode,
      reason: failure.reason,
      projectId: request.projectId,
      blueprintId: request.blueprintId,
      savedSnapshotId: request.savedSnapshotId,
      currentDefaultSnapshotId: failure.currentDefaultSnapshotId,
      ...(request.cohortSessionId ? { cohortSessionId: request.cohortSessionId } : {}),
      ...(failure.transport ? { transport: failure.transport } : {}),
      ...(failure.integrationFailureMode
        ? { integrationFailureMode: failure.integrationFailureMode }
        : {}),
    },
  });

  deps.logger.warn("runtime blueprint snapshot guard blocked candidate access", {
    customerId: request.customerId,
    examId: request.examId,
    examAttemptId: request.examAttemptId ?? null,
    cohortSessionId: request.cohortSessionId ?? null,
    candidateId: request.candidateId ?? null,
    candidateEmail: request.candidateEmail ?? null,
    projectId: request.projectId,
    blueprintId: request.blueprintId,
    savedSnapshotId: request.savedSnapshotId,
    currentDefaultSnapshotId: failure.currentDefaultSnapshotId,
    failureMode: failure.failureMode,
    reason: failure.reason,
    integrationSurface: BLUEPRINT_DETAIL_INTEGRATION_SURFACE,
    transport: failure.transport ?? null,
  });
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
