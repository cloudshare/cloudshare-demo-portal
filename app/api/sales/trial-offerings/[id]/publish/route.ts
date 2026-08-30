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
        forConnection: (connection) =>
          createCloudShareSalesDelivery(services.cloudshareClientFactory.forConnection(connection)),
      },
      itemProvisioningValidatorFactory: {
        forConnection: (connection) =>
          createCloudShareSalesItemProvisioningValidator(
            services.cloudshareClientFactory.forConnection(connection),
          ),
      },
      projectMemberSourceFactory: {
        forConnection: (connection) =>
          createCloudShareProjectMemberSource(
            services.cloudshareClientFactory.forConnection(connection),
          ),
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
