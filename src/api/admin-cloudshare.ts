import {
  CloudShareConnectionTestError,
  MissingCloudShareConnectionError,
  saveCloudShareConnection,
  testCloudShareConnection,
  type CloudShareClientFactory,
  type CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { Logger } from "@/observability/logger";

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
  readonly logger: Logger;
  readonly now?: () => Date;
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

  const connection = await saveCloudShareConnection(deps.connections, {
    customerId: request.customerId,
    apiId: (body as { apiId: string }).apiId.trim(),
    apiKey: (body as { apiKey: string }).apiKey.trim(),
    webhookSecret: (body as { webhookSecret: string }).webhookSecret.trim(),
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
    },
  };
}

export async function handleTestCloudShareConnection(
  deps: AdminCloudShareDeps,
  request: AdminCloudShareRequest,
): Promise<AdminCloudShareResponse> {
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
      customerId: request.customerId,
      verifiedAt: result.verifiedAt.toISOString(),
    });

    return {
      status: 200,
      body: {
        status: result.status,
        message: result.message,
        verifiedAt: result.verifiedAt.toISOString(),
      },
    };
  } catch (error) {
    if (error instanceof MissingCloudShareConnectionError) {
      return { status: 404, body: { error: "Save a CloudShare Connection before testing it." } };
    }
    if (error instanceof CloudShareConnectionTestError) {
      deps.logger.warn("cloudshare connection test failed", {
        customerId: request.customerId,
        error: error.causeMessage,
      });
      return {
        status: 502,
        body: { error: error.message },
      };
    }
    throw error;
  }
}
