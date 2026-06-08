import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import { handleCloudShareWebhook } from "@/api/cloudshare-webhook";
import { reconcileEnvironment } from "@/domain/environment-reconcile";
import { CLOUDSHARE_WEBHOOK_SIGNATURE_HEADER } from "@/integrations/cloudshare/webhooks";

/**
 * Inbound CloudShare environment webhook. Fed by real CloudShare in live mode (via
 * the tunnel) and by the environment simulator in demo mode — identical payloads,
 * one code path.
 *
 * The raw body is read as text (not parsed) because the HMAC signature is computed
 * over the exact bytes; re-serialising JSON would change them and break verification.
 */
export async function POST(request: Request) {
  const { config, environmentSource, environments, webhookIdempotency, logger } =
    getServices();

  const rawBody = await request.text();
  const signature = request.headers.get(CLOUDSHARE_WEBHOOK_SIGNATURE_HEADER);

  const { status, body } = await handleCloudShareWebhook(
    {
      secret: config.secrets.webhookSecret,
      idempotency: webhookIdempotency,
      reconcile: (environmentExternalId) =>
        reconcileEnvironment(
          { source: environmentSource, environments, now: () => new Date() },
          environmentExternalId,
        ),
      logger,
    },
    { rawBody, signature },
  );

  return NextResponse.json(body, { status });
}
