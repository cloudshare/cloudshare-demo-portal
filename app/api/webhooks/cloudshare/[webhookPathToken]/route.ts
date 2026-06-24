import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import { handleCloudShareWebhook } from "@/api/cloudshare-webhook";
import { reconcileEnvironment } from "@/domain/environment-reconcile";
import { createCloudShareEnvironmentSource } from "@/integrations/cloudshare/environment";
import {
  CLOUDSHARE_WEBHOOK_SIGNATURE_HEADER,
  type CloudShareEnvironmentEvent,
} from "@/integrations/cloudshare/webhooks";
import type { CloudShareConnectionRecord } from "@/domain/cloudshare-connection";

/**
 * Inbound CloudShare environment webhook. The opaque path token resolves the
 * Customer first, then the handler verifies the signature with that Customer's
 * stored webhook secret before the payload is trusted.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ webhookPathToken: string }> },
) {
  const services = getServices();
  await services.ensurePortalSeeded();

  const rawBody = await request.text();
  const signature = request.headers.get(CLOUDSHARE_WEBHOOK_SIGNATURE_HEADER);
  const { webhookPathToken } = await context.params;

  const { status, body } = await handleCloudShareWebhook(
    {
      connections: services.cloudshareConnections,
      idempotency: services.webhookIdempotency,
      resolveCorrelation: (connection, event) =>
        resolveWebhookEnvironmentCorrelation(services, connection, event),
      reconcile: (connection, environmentExternalId, event) =>
        reconcileEnvironment(
          {
            source: createCloudShareEnvironmentSource(
              services.cloudshareClientFactory.forConnection(connection),
            ),
            environments: services.environments,
            now: () => new Date(),
          },
          environmentExternalId,
        ).then(async (record) => {
          const correlation = await resolveWebhookEnvironmentCorrelation(services, connection, event);
          const launch = correlation.launch;
          const attempt = launch
            ? await services.examAttempts.findById(launch.examAttemptId)
            : null;
          return {
            environmentExternalId,
            status: record?.status,
            correlation: launch
              ? {
                  customerId: attempt?.customerId ?? connection.customerId,
                  examAttemptId: attempt?.id ?? null,
                  examId: attempt?.examId ?? null,
                  candidateEmail: launch.participantEmail ?? null,
                }
              : undefined,
          };
        }),
      logger: services.logger,
      eventLog: services.eventLog,
      diagnostics: services.diagnosticRecorder,
      now: () => new Date(),
    },
    { webhookPathToken, rawBody, signature },
  );

  return NextResponse.json(body, { status });
}

async function resolveWebhookEnvironmentCorrelation(
  services: ReturnType<typeof getServices>,
  connection: CloudShareConnectionRecord,
  event: CloudShareEnvironmentEvent,
) {
  const existingLaunch = await services.labLaunches.findByCustomerIdAndEnvironmentExternalId(
    connection.customerId,
    event.environmentExternalId,
  );
  if (existingLaunch) {
    const attempt = await services.examAttempts.findById(existingLaunch.examAttemptId);
    return {
      launch: existingLaunch,
      customerId: attempt?.customerId ?? connection.customerId,
      examAttemptId: attempt?.id ?? null,
      examId: attempt?.examId ?? null,
      candidateEmail: existingLaunch.participantEmail ?? null,
    };
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

  const correlatedLaunch = {
    ...pendingLaunch,
    environmentExternalId: event.environmentExternalId,
    environmentId: event.environmentExternalId,
  };
  await services.labLaunches.save(correlatedLaunch);

  const attempt = await services.examAttempts.findById(correlatedLaunch.examAttemptId);
  return {
    launch: correlatedLaunch,
    customerId: attempt?.customerId ?? connection.customerId,
    examAttemptId: attempt?.id ?? null,
    examId: attempt?.examId ?? null,
    candidateEmail: correlatedLaunch.participantEmail ?? event.ownerEmail,
  };
}
