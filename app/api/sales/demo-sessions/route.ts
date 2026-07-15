import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handleCreateSalesDemoSession } from "@/api/sales-demo-sessions";
import { handleListSalesSessionOperations } from "@/api/sales-session-operations";
import { createPrismaSalesRecordRepository } from "@/persistence/prisma-sales-record-repository";
import { createPrismaItemRepository } from "@/persistence/prisma-item-repository";
import { createPrismaSalesDemoSessionRepository } from "@/persistence/prisma-sales-demo-session-repository";
import { createCloudShareSalesDelivery } from "@/integrations/cloudshare/sales-delivery";
import { createCloudShareSalesItemProvisioningValidator } from "@/integrations/cloudshare/sales-item-provisioning";
import { createCloudShareProjectMemberSource } from "@/integrations/cloudshare/project-members";
import { createPrismaSalesSessionConfigurationRepository } from "@/persistence/prisma-sales-session-configuration-repository";
import { createPrismaSalesTimezoneCacheRepository } from "@/persistence/prisma-sales-timezone-repository";

async function context() {
  const services = getServices();
  await services.ensurePortalSeeded();
  const session = await getPortalAdminSession(services, (await cookies()).get(PORTAL_SESSION_COOKIE)?.value);
  return { services, session: session && session.workspace === "sales" ? session : null };
}

export async function GET(request: Request) {
  const { services, session } = await context();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const query = new URL(request.url).searchParams;
  const result = await handleListSalesSessionOperations(
    { sessions: createPrismaSalesDemoSessionRepository(services.prisma) },
    { customerId: session.customerId, actor: { type: "admin", id: session.userId, email: session.email }, lifecycle: query.get("lifecycle"), opportunityId: query.get("opportunityId") },
  );
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(request: Request) {
  const { services, session } = await context();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  const result = await handleCreateSalesDemoSession({
    records: createPrismaSalesRecordRepository(services.prisma), items: createPrismaItemRepository(services.prisma), sessions: createPrismaSalesDemoSessionRepository(services.prisma), connections: services.cloudshareConnections,
    deliveryFactory: { forConnection: (connection) => createCloudShareSalesDelivery(services.cloudshareClientFactory.forConnection(connection)) }, itemProvisioningValidatorFactory: { forConnection: (connection) => createCloudShareSalesItemProvisioningValidator(services.cloudshareClientFactory.forConnection(connection)) }, projectMemberSourceFactory: { forConnection: (connection) => createCloudShareProjectMemberSource(services.cloudshareClientFactory.forConnection(connection)) }, settings: createPrismaSalesSessionConfigurationRepository(services.prisma), timezones: createPrismaSalesTimezoneCacheRepository(services.prisma), diagnostics: services.diagnosticRecorder, audit: services.audit,
  }, { customerId: session.customerId, actor: { type: "admin", id: session.userId, email: session.email }, body });
  return NextResponse.json(result.body, { status: result.status });
}
