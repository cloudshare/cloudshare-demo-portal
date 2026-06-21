import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import { handleCloudShareWebhook } from "@/api/cloudshare-webhook";
import { reconcileEnvironment } from "@/domain/environment-reconcile";
import { createCloudShareEnvironmentSource } from "@/integrations/cloudshare/environment";
import { CLOUDSHARE_WEBHOOK_SIGNATURE_HEADER } from "@/integrations/cloudshare/webhooks";

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
      reconcile: (connection, environmentExternalId) =>
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
          const launch = await services.labLaunches.findByCustomerIdAndEnvironmentExternalId(
            connection.customerId,
            environmentExternalId,
          );
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
