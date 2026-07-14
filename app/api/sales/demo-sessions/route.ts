import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handleCreateSalesDemoSession } from "@/api/sales-demo-sessions";
import { createPrismaSalesRecordRepository } from "@/persistence/prisma-sales-record-repository";
import { createPrismaItemRepository } from "@/persistence/prisma-item-repository";
import { createPrismaSalesDemoSessionRepository } from "@/persistence/prisma-sales-demo-session-repository";
import { createCloudShareSalesDelivery } from "@/integrations/cloudshare/sales-delivery";

async function context() {
  const services = getServices();
  await services.ensurePortalSeeded();
  const session = await getPortalAdminSession(services, (await cookies()).get(PORTAL_SESSION_COOKIE)?.value);
  return { services, session: session && session.workspace === "sales" ? session : null };
}

export async function GET(request: Request) {
  const { services, session } = await context();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const opportunityId = new URL(request.url).searchParams.get("opportunityId");
  if (!opportunityId) return NextResponse.json({ sessions: [] });
  const sessions = await createPrismaSalesDemoSessionRepository(services.prisma).listByOpportunity(session.customerId, opportunityId);
  return NextResponse.json({ sessions });
}

export async function POST(request: Request) {
  const { services, session } = await context();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  const result = await handleCreateSalesDemoSession({
    records: createPrismaSalesRecordRepository(services.prisma), items: createPrismaItemRepository(services.prisma), sessions: createPrismaSalesDemoSessionRepository(services.prisma), connections: services.cloudshareConnections,
    deliveryFactory: { forConnection: (connection) => createCloudShareSalesDelivery(services.cloudshareClientFactory.forConnection(connection)) }, diagnostics: services.diagnosticRecorder, audit: services.audit,
  }, { customerId: session.customerId, actor: { type: "admin", id: session.userId, email: session.email }, body });
  return NextResponse.json(result.body, { status: result.status });
}
