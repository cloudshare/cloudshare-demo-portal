import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handlePublishSalesTrialOffering } from "@/api/sales-trial-offerings";
import { createPrismaItemRepository } from "@/persistence/prisma-item-repository";
import { createPrismaSalesTrialOfferingRepository } from "@/persistence/prisma-sales-trial-offering-repository";
import { createPrismaSalesTimezoneCacheRepository } from "@/persistence/prisma-sales-timezone-repository";
import { createCloudShareProjectMemberSource } from "@/integrations/cloudshare/project-members";
import { createCloudShareSalesDelivery } from "@/integrations/cloudshare/sales-delivery";
import { createCloudShareSalesItemProvisioningValidator } from "@/integrations/cloudshare/sales-item-provisioning";
import { createSalesTrialCloudShareObserver } from "@/api/sales-trial-cloudshare-diagnostics";

export async function POST(
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
  const { id } = await params;
  const result = await handlePublishSalesTrialOffering(
    {
      offerings: createPrismaSalesTrialOfferingRepository(services.prisma),
      items: createPrismaItemRepository(services.prisma),
      connections: services.cloudshareConnections,
      timezones: createPrismaSalesTimezoneCacheRepository(services.prisma),
      deliveryFactory: {
        forConnection: (connection, options) =>
          createCloudShareSalesDelivery(services.cloudshareClientFactory.forConnection(connection, options)),
      },
      itemProvisioningValidatorFactory: {
        forConnection: (connection, options) =>
          createCloudShareSalesItemProvisioningValidator(
            services.cloudshareClientFactory.forConnection(connection, options),
          ),
      },
      projectMemberSourceFactory: {
        forConnection: (connection, options) =>
          createCloudShareProjectMemberSource(
            services.cloudshareClientFactory.forConnection(connection, options),
          ),
      },
      cloudshareObserver: ({ customerId, actor, correlationId, offeringId }) => {
        const observer = createSalesTrialCloudShareObserver({ diagnostics: services.diagnosticRecorder, customerId, actor, correlationId, source: "sales-trial-offerings", subject: { type: "sales_trial_offering", id: offeringId }, externalIds: { offeringId } });
        return observer;
      },
      diagnostics: services.diagnosticRecorder,
      audit: services.audit,
    },
    {
      customerId: session.customerId,
      actor: { type: "admin", id: session.userId, email: session.email },
      id,
    },
  );
  return NextResponse.json(result.body, { status: result.status });
}
