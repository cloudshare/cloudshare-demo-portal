import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handleListSalesTrialOfferingParticipants } from "@/api/sales-trial-enrollment";
import { createCloudShareSalesDelivery } from "@/integrations/cloudshare/sales-delivery";
import { createPrismaSalesTrialEnrollmentRepository } from "@/persistence/prisma-sales-trial-enrollment-repository";
import { createPrismaSalesTrialOfferingRepository } from "@/persistence/prisma-sales-trial-offering-repository";
import { handleEndSalesTrialOffering } from "@/api/sales-trial-offerings";
import { salesTrialEndingDeps } from "@/api/sales-trial-ending-reconciliation";
import { createSalesTrialCloudShareObserver } from "@/api/sales-trial-cloudshare-diagnostics";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const services = getServices();
  await services.ensurePortalSeeded();
  const session = await getPortalAdminSession(
    services,
    (await cookies()).get(PORTAL_SESSION_COOKIE)?.value,
  );
  if (!session || session.workspace !== "sales") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const offeringId = (await params).id;
  const offeringRepository = createPrismaSalesTrialOfferingRepository(services.prisma);
  const result = await handleListSalesTrialOfferingParticipants(
    {
      offerings: offeringRepository,
      enrollments: createPrismaSalesTrialEnrollmentRepository(services.prisma),
      connections: services.cloudshareConnections,
      deliveryFactory: {
        forConnection: (connection, options) =>
          createCloudShareSalesDelivery(
            services.cloudshareClientFactory.forConnection(connection, options),
          ),
      },
      cloudshareObserver: ({ customerId, actor, correlationId, subject }) => {
        const observer = createSalesTrialCloudShareObserver({ diagnostics: services.diagnosticRecorder, customerId, actor, correlationId, source: "sales-trial-enrollment", subject });
        return observer;
      },
      diagnostics: services.diagnosticRecorder,
      audit: services.audit,
      reconcileEnding: async ({ customerId, offeringId, actor }) => {
        await handleEndSalesTrialOffering(salesTrialEndingDeps(services), {
          customerId,
          id: offeringId,
          actor,
        });
      },
    },
    {
      customerId: session.customerId,
      offeringId,
      actor: {
        type: "admin",
        id: session.userId,
        email: session.email,
      },
    },
  );

  return NextResponse.json(result.body, { status: result.status });
}
