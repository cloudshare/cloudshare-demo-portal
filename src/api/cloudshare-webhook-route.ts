import { reconcileEnvironment } from "@/domain/environment-reconcile";
import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { EnvironmentRepository } from "@/domain/environment";
import type { EventLogRepository } from "@/domain/event-log";
import type { LabLaunch, LabLaunchRepository } from "@/domain/lab-launch";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRecord,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { Logger } from "@/observability/logger";
import type { WebhookIdempotencyStore } from "@/domain/webhook";
import { createCloudShareEnvironmentSource } from "@/integrations/cloudshare/environment";
import type { CloudShareEnvironmentEvent } from "@/integrations/cloudshare/webhooks";
import {
  handleCloudShareWebhook,
  type CloudShareWebhookDeps,
  type CloudShareWebhookResponse,
  type WebhookEventCorrelation,
} from "./cloudshare-webhook";

export interface CloudShareWebhookRouteServices {
  readonly cloudshareConnections: CloudShareConnectionRepository;
  readonly webhookIdempotency: WebhookIdempotencyStore;
  readonly logger: Logger;
  readonly eventLog: EventLogRepository;
  readonly diagnosticRecorder?: DiagnosticRecorder;
  readonly cloudshareClientFactory: CloudShareClientFactory;
  readonly environments: EnvironmentRepository;
  readonly labLaunches: LabLaunchRepository;
  readonly examAttempts: Pick<ExamAttemptRepository, "findById">;
}

export interface CloudShareWebhookRouteRequest {
  readonly webhookPathToken: string;
  readonly rawBody: string;
  readonly signature: string | null;
}

interface CloudShareWebhookRouteOptions {
  readonly now?: () => Date;
}

interface ResolvedWebhookCorrelation extends WebhookEventCorrelation {
  readonly launch: LabLaunch | null;
}

export function buildCloudShareWebhookRouteDeps(
  services: CloudShareWebhookRouteServices,
  options: CloudShareWebhookRouteOptions = {},
): CloudShareWebhookDeps {
  const now = options.now ?? (() => new Date());
  return {
    connections: services.cloudshareConnections,
    idempotency: services.webhookIdempotency,
    resolveCorrelation: (connection, event) =>
      resolveWebhookEnvironmentCorrelation(services, connection, event),
    reconcile: (connection, environmentExternalId, event) =>
      reconcileCloudShareWebhookEnvironment(
        services,
        { connection, environmentExternalId, event, now },
      ),
    logger: services.logger,
    eventLog: services.eventLog,
    diagnostics: services.diagnosticRecorder,
    now,
  };
}

export async function handleCloudShareWebhookRoute(
  services: CloudShareWebhookRouteServices,
  request: CloudShareWebhookRouteRequest,
  options: CloudShareWebhookRouteOptions = {},
): Promise<CloudShareWebhookResponse> {
  return handleCloudShareWebhook(
    buildCloudShareWebhookRouteDeps(services, options),
    request,
  );
}

async function reconcileCloudShareWebhookEnvironment(
  services: CloudShareWebhookRouteServices,
  input: {
    readonly connection: CloudShareConnectionRecord;
    readonly environmentExternalId: string;
    readonly event: CloudShareEnvironmentEvent;
    readonly now: () => Date;
  },
) {
  const record = await reconcileEnvironment(
    {
      source: createCloudShareEnvironmentSource(
        services.cloudshareClientFactory.forConnection(input.connection, { scope: "customer_default", reason: "unanchored_support_read" }),
      ),
      environments: services.environments,
      now: input.now,
    },
    input.environmentExternalId,
  );
  const correlation = await resolveWebhookEnvironmentCorrelation(
    services,
    input.connection,
    input.event,
  );

  return {
    environmentExternalId: input.environmentExternalId,
    status: record?.status,
    correlation: correlation.launch
      ? {
          customerId: correlation.customerId ?? input.connection.customerId,
          examAttemptId: correlation.examAttemptId ?? null,
          examId: correlation.examId ?? null,
          candidateEmail: correlation.candidateEmail ?? null,
        }
      : undefined,
  };
}

async function resolveWebhookEnvironmentCorrelation(
  services: CloudShareWebhookRouteServices,
  connection: CloudShareConnectionRecord,
  event: CloudShareEnvironmentEvent,
): Promise<ResolvedWebhookCorrelation> {
  const existingLaunch = await services.labLaunches.findByCustomerIdAndEnvironmentExternalId(
    connection.customerId,
    event.environmentExternalId,
  );
  if (existingLaunch) {
    return resolveCorrelationFromLaunch(existingLaunch, services, connection.customerId);
  }

  if (!event.ownerEmail || !services.labLaunches.findPendingEnvironmentCorrelation) {
    return {
      launch: null,
      customerId: connection.customerId,
      examAttemptId: null,
      examId: null,
      candidateEmail: null,
    };
  }

  const pendingLaunch = await services.labLaunches.findPendingEnvironmentCorrelation({
    customerId: connection.customerId,
    participantEmail: event.ownerEmail,
    environmentName: event.environmentName,
  });
  if (!pendingLaunch) {
    return {
      launch: null,
      customerId: connection.customerId,
      examAttemptId: null,
      examId: null,
      candidateEmail: event.ownerEmail,
    };
  }

  const correlatedLaunch: LabLaunch = {
    ...pendingLaunch,
    environmentExternalId: event.environmentExternalId,
    environmentId: event.environmentExternalId,
  };
  await services.labLaunches.save(correlatedLaunch);

  return resolveCorrelationFromLaunch(correlatedLaunch, services, connection.customerId, event.ownerEmail);
}

async function resolveCorrelationFromLaunch(
  launch: LabLaunch,
  services: CloudShareWebhookRouteServices,
  fallbackCustomerId: string,
  fallbackCandidateEmail?: string | null,
): Promise<ResolvedWebhookCorrelation> {
  const attempt = await services.examAttempts.findById(launch.examAttemptId);
  return {
    launch,
    customerId: attempt?.customerId ?? fallbackCustomerId,
    examAttemptId: attempt?.id ?? null,
    examId: attempt?.examId ?? null,
    candidateEmail: launch.participantEmail ?? fallbackCandidateEmail ?? null,
  };
}
