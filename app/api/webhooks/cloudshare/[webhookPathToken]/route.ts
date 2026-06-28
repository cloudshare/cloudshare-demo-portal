import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import { handleCloudShareWebhookRoute } from "@/api/cloudshare-webhook-route";
import {
  CLOUDSHARE_WEBHOOK_SIGNATURE_HEADER,
} from "@/integrations/cloudshare/webhooks";

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

  const { status, body } = await handleCloudShareWebhookRoute(
    services,
    { webhookPathToken, rawBody, signature },
  );

  return NextResponse.json(body, { status });
}
