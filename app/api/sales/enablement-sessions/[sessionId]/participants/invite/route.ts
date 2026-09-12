import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { createPrismaSalesDemoSessionRepository } from "@/persistence/prisma-sales-demo-session-repository";
import { createPrismaSalesRecordRepository } from "@/persistence/prisma-sales-record-repository";
import { createPrismaSalesSessionParticipantRepository } from "@/persistence/prisma-sales-session-participant-repository";
import { createCloudShareSalesDelivery } from "@/integrations/cloudshare/sales-delivery";
import { handleInviteSalesSessionParticipants } from "@/api/sales-session-participants";
import { createPrismaSalesParticipantOperationRepository } from "@/persistence/prisma-sales-participant-operation-repository";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const services = getServices();
  await services.ensurePortalSeeded();
  const session = await getPortalAdminSession(
    services,
    (await cookies()).get(PORTAL_SESSION_COOKIE)?.value,
  );
  if (!session || session.workspace !== "sales")
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const result = await handleInviteSalesSessionParticipants(
    {
      sessions: createPrismaSalesDemoSessionRepository(services.prisma),
      records: createPrismaSalesRecordRepository(services.prisma),
      participants: createPrismaSalesSessionParticipantRepository(
        services.prisma,
      ),
      operationStates: createPrismaSalesParticipantOperationRepository(
        services.prisma,
      ),
      connections: services.cloudshareConnections,
      deliveryFactory: {
        forConnection: (connection) =>
          createCloudShareSalesDelivery(
            services.cloudshareClientFactory.forConnection(connection, {
              scope: "customer_default",
              reason: "unanchored_support_read",
            }),
          ),
      },
      diagnostics: services.diagnosticRecorder,
      audit: services.audit,
    },
    {
      customerId: session.customerId,
      sessionId: (await params).sessionId,
      actor: { type: "admin", id: session.userId, email: session.email },
      body,
    },
  );
  return NextResponse.json(result.body, { status: result.status });
}
