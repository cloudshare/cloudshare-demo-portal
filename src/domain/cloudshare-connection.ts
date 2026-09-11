import type {
  CloudShareClient,
  CloudShareRequestObservation,
  V4TokenAcquisitionEvent,
} from "@/integrations/cloudshare";
import type { CloudShareWorkflowObservationContext, CloudShareWorkflowSequenceAllocator } from "@/ports/cloudshare-observation";
import type { DiagnosticActor, DiagnosticSubject } from "./diagnostic-log";
import { CLOUDSHARE_429_ADMIN_SUPPORT_GUIDANCE } from "./cloudshare-rate-limit-message";
import {
  CloudShareError,
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
  isCloudShareRateLimitError,
} from "@/integrations/cloudshare";
import { pingCloudShareV3 } from "@/integrations/cloudshare";

export interface CloudShareConnectionRecord {
  readonly customerId: string;
  readonly apiId: string;
  readonly apiKey: string;
  readonly webhookSecret: string;
  readonly webhookPathToken: string;
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
  findByWebhookPathToken(webhookPathToken: string): Promise<CloudShareConnectionRecord | null>;
  markVerified(customerId: string, verifiedAt: Date): Promise<void>;
}

export function buildCloudShareWebhookPath(webhookPathToken: string): string {
  return `/api/webhooks/cloudshare/${encodeURIComponent(webhookPathToken)}`;
}

export type { CloudShareWorkflowObservationContext } from "@/ports/cloudshare-observation";

type CloudShareClientObservationCallbacks = {
  readonly onRequest?: (event: CloudShareRequestObservation) => Promise<void> | void;
  readonly onAcquisition?: (event: V4TokenAcquisitionEvent) => Promise<void> | void;
};

/** Each production client declares a real workflow or an intentional Customer-only escape. */
export type CloudShareClientObservationOptions = CloudShareClientObservationCallbacks & (
  | { readonly scope: "workflow"; readonly workflow: CloudShareWorkflowObservationContext }
  | { readonly scope: "customer_default"; readonly reason: "catalogue_resource_read" | "connection_check" | "unanchored_support_read" }
  | { readonly scope: "custom_observer"; readonly correlationId: string; readonly actor: DiagnosticActor; readonly subject: DiagnosticSubject | (() => DiagnosticSubject); readonly sequenceAllocator?: CloudShareWorkflowSequenceAllocator; readonly source?: string; readonly externalIds?: Record<string, string> }
);

export interface CloudShareClientFactory {
  forConnection(
    connection: CloudShareConnectionRecord,
    options: CloudShareClientObservationOptions | undefined,
  ): CloudShareClient;
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

const CLOUDSHARE_V3_PING_URL = "https://use.cloudshare.com/api/v3/ping";
const CLOUDSHARE_V3_PING_LABEL = "CloudShare Classic v3 ping";

function isNamedCloudShareError(error: unknown, name: string): error is {
  readonly name: string;
  readonly message: string;
  readonly context?: Record<string, unknown>;
  readonly status?: number;
} {
  return error instanceof Error && error.name === name;
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
    const client = deps.cloudshare.forConnection(connection, {
      scope: "customer_default",
      reason: "connection_check",
    });
    const pong = await pingCloudShareV3(client);
    const verifiedAt = (deps.now ?? (() => new Date()))();
    await deps.connections.markVerified(customerId, verifiedAt);
    return { status: "connected", message: pong, verifiedAt };
  } catch (error) {
    if (isCloudShareRateLimitError(error)) {
      throw new CloudShareConnectionTestError(
        CLOUDSHARE_429_ADMIN_SUPPORT_GUIDANCE,
        error.message,
        {
          operation: "test_connection",
          integrationSurface: "cloudshare.v3.ping",
          integrationLabel: CLOUDSHARE_V3_PING_LABEL,
          method: "GET",
          path: "/ping",
          requestUrl: CLOUDSHARE_V3_PING_URL,
          failureMode: "rate_limit",
          responseStatus: error.status,
          requestHeaders: error.context?.requestHeaders,
          responseHeaders: error.context?.responseHeaders,
          responseBody: error.context?.responseBody,
          network: error.context?.network,
          tls: error.context?.tls,
        },
      );
    }
    if (error instanceof CloudShareRequestError || isNamedCloudShareError(error, "CloudShareRequestError")) {
      throw new CloudShareConnectionTestError(
        `CloudShare returned ${error.status} to the v3 ping. Check API ID and API key.`,
        error.message,
        {
          operation: "test_connection",
          integrationSurface: "cloudshare.v3.ping",
          integrationLabel: CLOUDSHARE_V3_PING_LABEL,
          method: "GET",
          path: "/ping",
          requestUrl: CLOUDSHARE_V3_PING_URL,
          failureMode: "http_status",
          responseStatus: error.status,
          requestHeaders: error.context?.requestHeaders,
          responseHeaders: error.context?.responseHeaders,
          responseBody: error.context?.responseBody,
          network: error.context?.network,
          tls: error.context?.tls,
        },
      );
    }
    if (error instanceof CloudShareTransportError || isNamedCloudShareError(error, "CloudShareTransportError")) {
      throw new CloudShareConnectionTestError(
        "CloudShare ping could not reach the server. Check network reachability.",
        error.message,
        {
          operation: "test_connection",
          integrationSurface: "cloudshare.v3.ping",
          integrationLabel: CLOUDSHARE_V3_PING_LABEL,
          method: "GET",
          path: "/ping",
          requestUrl: CLOUDSHARE_V3_PING_URL,
          failureMode: "transport",
          requestHeaders: error.context?.requestHeaders,
          cause: error.context?.cause,
          network: error.context?.network,
          tls: error.context?.tls,
        },
      );
    }
    if (error instanceof CloudShareResponseError || isNamedCloudShareError(error, "CloudShareResponseError")) {
      throw new CloudShareConnectionTestError(
        "CloudShare ping returned an unexpected response.",
        error.message,
        {
          operation: "test_connection",
          integrationSurface: "cloudshare.v3.ping",
          integrationLabel: CLOUDSHARE_V3_PING_LABEL,
          method: "GET",
          path: "/ping",
          requestUrl: CLOUDSHARE_V3_PING_URL,
          failureMode: "unexpected_response",
          requestHeaders: error.context?.requestHeaders,
          responseHeaders: error.context?.responseHeaders,
          responseBody: error.context?.responseBody,
          network: error.context?.network,
          tls: error.context?.tls,
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
          integrationLabel: CLOUDSHARE_V3_PING_LABEL,
          method: "GET",
          path: "/ping",
          requestUrl: CLOUDSHARE_V3_PING_URL,
          failureMode: "cloudshare_error",
        },
      );
    }
    throw error;
  }
}
