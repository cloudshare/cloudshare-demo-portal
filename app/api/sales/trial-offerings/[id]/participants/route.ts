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
  if ((await offeringRepository.findById(session.customerId, offeringId))?.status === "ending") {
    await handleEndSalesTrialOffering(salesTrialEndingDeps(services), {
      customerId: session.customerId,
      id: offeringId,
      actor: { type: "admin", id: session.userId, email: session.email },
    });
  }
  const result = await handleListSalesTrialOfferingParticipants(
    {
      offerings: offeringRepository,
      enrollments: createPrismaSalesTrialEnrollmentRepository(services.prisma),
      connections: services.cloudshareConnections,
      deliveryFactory: {
        forConnection: (connection) =>
          createCloudShareSalesDelivery(
            services.cloudshareClientFactory.forConnection(connection),
          ),
      },
      diagnostics: services.diagnosticRecorder,
      audit: services.audit,
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
