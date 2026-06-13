import type { CloudShareClient } from "@/integrations/cloudshare";
import {
  CloudShareError,
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
} from "@/integrations/cloudshare";
import { pingCloudShareV3 } from "@/integrations/cloudshare";

export interface CloudShareConnectionRecord {
  readonly customerId: string;
  readonly apiId: string;
  readonly apiKey: string;
  readonly webhookSecret: string;
  readonly connectedAt: Date;
  readonly verifiedAt: Date | null;
}

export interface SaveCloudShareConnectionInput {
  readonly customerId: string;
  readonly apiId: string;
  readonly apiKey: string;
  readonly webhookSecret: string;
}

export interface CloudShareConnectionRepository {
  save(input: SaveCloudShareConnectionInput): Promise<CloudShareConnectionRecord>;
  findByCustomerId(customerId: string): Promise<CloudShareConnectionRecord | null>;
  markVerified(customerId: string, verifiedAt: Date): Promise<void>;
}

export interface CloudShareClientFactory {
  forConnection(connection: CloudShareConnectionRecord): CloudShareClient;
}

export class MissingCloudShareConnectionError extends Error {
  constructor(customerId: string) {
    super(`No CloudShare Connection exists for customer ${customerId}`);
    this.name = "MissingCloudShareConnectionError";
  }
}

export class CloudShareConnectionTestError extends Error {
  constructor(
    message: string,
    readonly causeMessage: string,
    readonly diagnostic?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CloudShareConnectionTestError";
  }
}

export async function testCloudShareConnection(
  deps: {
    readonly connections: CloudShareConnectionRepository;
    readonly cloudshare: CloudShareClientFactory;
    readonly now?: () => Date;
  },
  customerId: string,
): Promise<{ status: "connected"; message: "pong"; verifiedAt: Date }> {
  const connection = await deps.connections.findByCustomerId(customerId);
  if (!connection) {
    throw new MissingCloudShareConnectionError(customerId);
  }

  try {
    const client = deps.cloudshare.forConnection(connection);
    const pong = await pingCloudShareV3(client);
    const verifiedAt = (deps.now ?? (() => new Date()))();
    await deps.connections.markVerified(customerId, verifiedAt);
    return { status: "connected", message: pong, verifiedAt };
  } catch (error) {
    if (error instanceof CloudShareRequestError) {
      throw new CloudShareConnectionTestError(
        `CloudShare returned ${error.status} to the v3 ping. Check API ID and API key.`,
        error.message,
        {
          operation: "test_connection",
          integrationSurface: "cloudshare.v3.ping",
          method: "GET",
          path: "/ping",
          failureMode: "http_status",
          responseStatus: error.status,
        },
      );
    }
    if (error instanceof CloudShareTransportError) {
      throw new CloudShareConnectionTestError(
        "CloudShare ping could not reach the server. Check network reachability.",
        error.message,
        {
          operation: "test_connection",
          integrationSurface: "cloudshare.v3.ping",
          method: "GET",
          path: "/ping",
          failureMode: "transport",
        },
      );
    }
    if (error instanceof CloudShareResponseError) {
      throw new CloudShareConnectionTestError(
        "CloudShare ping returned an unexpected response.",
        error.message,
        {
          operation: "test_connection",
          integrationSurface: "cloudshare.v3.ping",
          method: "GET",
          path: "/ping",
          failureMode: "unexpected_response",
        },
      );
    }
    if (
      error instanceof CloudShareError ||
      (error instanceof Error && error.name.startsWith("CloudShare"))
    ) {
      throw new CloudShareConnectionTestError(
        "CloudShare connection test failed.",
        error instanceof Error ? error.message : String(error),
        {
          operation: "test_connection",
          integrationSurface: "cloudshare.v3.ping",
          method: "GET",
          path: "/ping",
          failureMode: "cloudshare_error",
        },
      );
    }
    throw error;
  }
}
