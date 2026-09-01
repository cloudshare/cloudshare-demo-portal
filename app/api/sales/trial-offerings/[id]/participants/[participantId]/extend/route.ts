import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handleExtendSalesTrialOfferingParticipant } from "@/api/sales-trial-enrollment";
import { createCloudShareSalesEnvironmentSource } from "@/integrations/cloudshare/sales-environment";
import { createPrismaSalesTrialEnrollmentRepository } from "@/persistence/prisma-sales-trial-enrollment-repository";
import { createPrismaSalesTrialOfferingRepository } from "@/persistence/prisma-sales-trial-offering-repository";
import { handleEndSalesTrialOffering } from "@/api/sales-trial-offerings";
import { salesTrialEndingDeps } from "@/api/sales-trial-ending-reconciliation";

export async function POST(
  _request: Request,
  {
    params,
  }: { params: Promise<{ id: string; participantId: string }> },
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

  const { id: offeringId, participantId } = await params;
  const result = await handleExtendSalesTrialOfferingParticipant(
    {
      offerings: createPrismaSalesTrialOfferingRepository(services.prisma),
      enrollments: createPrismaSalesTrialEnrollmentRepository(services.prisma),
      connections: services.cloudshareConnections,
      salesEnvironmentFactory: {
        forConnection: (connection) =>
          createCloudShareSalesEnvironmentSource(
            services.cloudshareClientFactory.forConnection(connection),
          ),
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
      enrollmentId: participantId,
      actor: {
        type: "admin",
        id: session.userId,
        email: session.email,
      },
    },
  );

  return NextResponse.json(result.body, { status: result.status });
}
