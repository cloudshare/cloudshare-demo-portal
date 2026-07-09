import {
  buildCloudShareWebhookPath,
  CloudShareConnectionTestError,
  MissingCloudShareConnectionError,
  testCloudShareConnection,
  type CloudShareClientFactory,
  type CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { Logger } from "@/observability/logger";
import type { ExamAuthoringCacheRepository } from "@/persistence/exam-authoring-cache-repository";
import type { AuditRepository } from "@/domain/audit-trail";
import type { DiagnosticActor } from "@/domain/diagnostic-log";
import { randomUUID } from "node:crypto";

export interface AdminCloudShareRequest {
  readonly customerId: string;
  readonly actor?: DiagnosticActor | null;
  readonly body?: unknown;
}

export interface AdminCloudShareResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export interface AdminCloudShareDeps {
  readonly connections: CloudShareConnectionRepository;
  readonly cloudshare: CloudShareClientFactory;
  readonly examAuthoringCache?: ExamAuthoringCacheRepository;
  readonly audit?: Pick<AuditRepository, "write">;
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly newCorrelationId?: () => string;
  readonly newAuditId?: () => string;
}

export interface AdminCloudShareConnectionServices {
  readonly cloudshareConnections: CloudShareConnectionRepository;
  readonly cloudshareClientFactory: CloudShareClientFactory;
  readonly examAuthoringCache?: ExamAuthoringCacheRepository;
  readonly audit?: Pick<AuditRepository, "write">;
  readonly logger: Logger;
}

export interface AdminCloudShareTestServices {
  readonly cloudshareConnections: CloudShareConnectionRepository;
  readonly cloudshareClientFactory: CloudShareClientFactory;
  readonly audit?: Pick<AuditRepository, "write">;
  readonly logger: Logger;
}

export function buildAdminCloudShareConnectionDeps(
  services: AdminCloudShareConnectionServices,
): Pick<AdminCloudShareDeps, "connections" | "cloudshare" | "examAuthoringCache" | "audit" | "logger"> {
  return {
    connections: services.cloudshareConnections,
    cloudshare: services.cloudshareClientFactory,
    examAuthoringCache: services.examAuthoringCache,
    ...(services.audit ? { audit: services.audit } : {}),
    logger: services.logger,
  };
}

export function buildAdminCloudShareTestDeps(
  services: AdminCloudShareTestServices,
): Pick<AdminCloudShareDeps, "connections" | "cloudshare" | "audit" | "logger"> {
  return {
    connections: services.cloudshareConnections,
    cloudshare: services.cloudshareClientFactory,
    ...(services.audit ? { audit: services.audit } : {}),
    logger: services.logger,
  };
}

export async function handleGetCloudShareConnection(
  deps: AdminCloudShareDeps,
  request: AdminCloudShareRequest,
): Promise<AdminCloudShareResponse> {
  const connection = await deps.connections.findByCustomerId(request.customerId);
  return {
    status: 200,
    body: {
      hasConnection: connection !== null,
      verifiedAt: connection?.verifiedAt?.toISOString() ?? null,
      connectedAt: connection?.connectedAt.toISOString() ?? null,
      webhookPathToken: connection?.webhookPathToken ?? null,
      webhookPath: connection ? buildCloudShareWebhookPath(connection.webhookPathToken) : null,
    },
  };
}

export async function handleSaveCloudShareConnection(
  deps: AdminCloudShareDeps,
  request: AdminCloudShareRequest,
): Promise<AdminCloudShareResponse> {
  const body = request.body;
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { apiId?: unknown }).apiId !== "string" ||
    typeof (body as { apiKey?: unknown }).apiKey !== "string" ||
    typeof (body as { webhookSecret?: unknown }).webhookSecret !== "string"
  ) {
    return {
      status: 400,
      body: { error: "apiId, apiKey, and webhookSecret are required" },
    };
  }

  const existing = await deps.connections.findByCustomerId(request.customerId);
  const trimmedApiId = (body as { apiId: string }).apiId.trim();
  const trimmedApiKey = (body as { apiKey: string }).apiKey.trim();
  const trimmedWebhookSecret = (body as { webhookSecret: string }).webhookSecret.trim();

  if (!existing && (!trimmedApiId || !trimmedApiKey || !trimmedWebhookSecret)) {
    return {
      status: 400,
      body: { error: "apiId, apiKey, and webhookSecret are required for the first CloudShare Connection save" },
    };
  }

  const connection = await deps.connections.save({
    customerId: request.customerId,
    apiId: trimmedApiId || existing?.apiId || "",
    apiKey: trimmedApiKey || existing?.apiKey || "",
    webhookSecret: trimmedWebhookSecret || existing?.webhookSecret || "",
  });
  await deps.examAuthoringCache?.clearCustomer(request.customerId);
  await safeRecordAudit(deps, {
    request,
    action: existing ? "cloudshare_connection.updated" : "cloudshare_connection.created",
    outcome: "success",
    details: {
      changedFields: summariseConnectionChanges({
        existing,
        apiId: trimmedApiId,
        apiKey: trimmedApiKey,
        webhookSecret: trimmedWebhookSecret,
      }),
      authoringCacheCleared: Boolean(deps.examAuthoringCache),
    },
  });

  deps.logger.info("cloudshare connection saved", {
    customerId: request.customerId,
    verifiedAt: connection.verifiedAt?.toISOString() ?? null,
  });

  return {
    status: 200,
    body: {
      hasConnection: true,
      connectedAt: connection.connectedAt.toISOString(),
      verifiedAt: connection.verifiedAt?.toISOString() ?? null,
      webhookPathToken: connection.webhookPathToken,
      webhookPath: buildCloudShareWebhookPath(connection.webhookPathToken),
    },
  };
}

export async function handleTestCloudShareConnection(
  deps: AdminCloudShareDeps,
  request: AdminCloudShareRequest,
): Promise<AdminCloudShareResponse> {
  const correlationId = (deps.newCorrelationId ?? randomUUID)();
  const occurredAt = (deps.now ?? (() => new Date()))().toISOString();
  try {
    const result = await testCloudShareConnection(
      {
        connections: deps.connections,
        cloudshare: deps.cloudshare,
        now: deps.now,
      },
      request.customerId,
    );

    deps.logger.info("cloudshare connection verified", {
      correlationId,
      customerId: request.customerId,
      operation: "test_connection",
      integrationSurface: "cloudshare.v3.ping",
      method: "GET",
      path: "/ping",
      responseStatus: 200,
      responseBody: result.message,
      verifiedAt: result.verifiedAt.toISOString(),
    });
    await safeRecordAudit(deps, {
      request,
      action: "cloudshare_connection.tested",
      outcome: "success",
      correlationId,
      details: {
        integrationSurface: "cloudshare.v3.ping",
        responseStatus: 200,
      },
    });

    return {
      status: 200,
      body: {
        status: result.status,
        message: result.message,
        verifiedAt: result.verifiedAt.toISOString(),
        correlationId,
        occurredAt,
      },
    };
  } catch (error) {
    if (error instanceof MissingCloudShareConnectionError) {
      await safeRecordAudit(deps, {
        request,
        action: "cloudshare_connection.tested",
        outcome: "failure",
        correlationId,
        error: "Save a CloudShare Connection before testing it.",
        details: { failureMode: "missing_connection" },
      });
      return { status: 404, body: { error: "Save a CloudShare Connection before testing it." } };
    }
    if (error instanceof CloudShareConnectionTestError) {
      deps.logger.warn("cloudshare connection test failed", {
        correlationId,
        customerId: request.customerId,
        ...error.diagnostic,
        error: error.causeMessage,
      });
      await safeRecordAudit(deps, {
        request,
        action: "cloudshare_connection.tested",
        outcome: "failure",
        correlationId,
        error: error.message,
        details: {
          integrationSurface: "cloudshare.v3.ping",
          failureMode: error.diagnostic?.failureMode ?? "cloudshare_connection_test_failed",
          responseStatus: error.diagnostic?.responseStatus,
        },
      });
      return {
        status: error.diagnostic?.failureMode === "rate_limit" ? 429 : 502,
        body: {
          error: error.message,
          correlationId,
          occurredAt,
          diagnostic: error.diagnostic ?? null,
        },
      };
    }
    throw error;
  }
}

function summariseConnectionChanges(input: {
  readonly existing: Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>;
  readonly apiId: string;
  readonly apiKey: string;
  readonly webhookSecret: string;
}): string[] {
  if (!input.existing) {
    return ["apiId", "apiKey", "webhookSecret"];
  }
  const changedFields: string[] = [];
  if (input.apiId && input.apiId !== input.existing.apiId) changedFields.push("apiId");
  if (input.apiKey && input.apiKey !== input.existing.apiKey) changedFields.push("apiKey");
  if (input.webhookSecret && input.webhookSecret !== input.existing.webhookSecret) {
    changedFields.push("webhookSecret");
  }
  return changedFields;
}

async function safeRecordAudit(
  deps: Pick<AdminCloudShareDeps, "audit" | "logger" | "now" | "newAuditId">,
  input: {
    readonly request: AdminCloudShareRequest;
    readonly action: string;
    readonly outcome: "success" | "failure" | "denied";
    readonly correlationId?: string;
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
      subjectType: "cloudshare_connection",
      subjectId: input.request.customerId,
      outcome: input.outcome,
      correlationId: input.correlationId ?? null,
      details: input.details ?? null,
      error: input.error ?? null,
      occurredAt: (deps.now ?? (() => new Date()))(),
    });
  } catch (error) {
    deps.logger.warn("admin cloudshare audit recording failed", {
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
