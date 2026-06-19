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
import { randomUUID } from "node:crypto";

export interface AdminCloudShareRequest {
  readonly customerId: string;
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
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly newCorrelationId?: () => string;
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
      return { status: 404, body: { error: "Save a CloudShare Connection before testing it." } };
    }
    if (error instanceof CloudShareConnectionTestError) {
      deps.logger.warn("cloudshare connection test failed", {
        correlationId,
        customerId: request.customerId,
        ...error.diagnostic,
        error: error.causeMessage,
      });
      return {
        status: 502,
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
