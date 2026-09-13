import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { createPrismaSalesDemoSessionRepository } from "@/persistence/prisma-sales-demo-session-repository";
import { createPrismaSalesRecordRepository } from "@/persistence/prisma-sales-record-repository";
import { createPrismaSalesSessionParticipantRepository } from "@/persistence/prisma-sales-session-participant-repository";
import { createCloudShareSalesDelivery } from "@/integrations/cloudshare/sales-delivery";
import { createCloudShareSalesEnvironmentSource } from "@/integrations/cloudshare/sales-environment";
import { createPrismaItemRepository } from "@/persistence/prisma-item-repository";
import { handleListSalesSessionParticipants } from "@/api/sales-session-participants";
/** Explicit legacy provider-backed roster read retained while consumers migrate. */
async function context() { const services = getServices(); await services.ensurePortalSeeded(); const session = await getPortalAdminSession(services, (await cookies()).get(PORTAL_SESSION_COOKIE)?.value); return { services, session: session?.workspace === "sales" ? session : null }; }
export async function GET(_: Request, { params }: { params: Promise<{ sessionId: string }> }) { const { services, session } = await context(); const headers = { "Cache-Control": "no-store" }; if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers }); const result = await handleListSalesSessionParticipants({ sessions: createPrismaSalesDemoSessionRepository(services.prisma), items: createPrismaItemRepository(services.prisma), records: createPrismaSalesRecordRepository(services.prisma), participants: createPrismaSalesSessionParticipantRepository(services.prisma), connections: services.cloudshareConnections, deliveryFactory: { forConnection: (connection: Parameters<typeof services.cloudshareClientFactory.forConnection>[0]) => createCloudShareSalesDelivery(services.cloudshareClientFactory.forConnection(connection, { scope: "customer_default", reason: "unanchored_support_read" })) }, salesEnvironmentFactory: { forConnection: (connection: Parameters<typeof services.cloudshareClientFactory.forConnection>[0]) => createCloudShareSalesEnvironmentSource(services.cloudshareClientFactory.forConnection(connection, { scope: "customer_default", reason: "unanchored_support_read" })) }, diagnostics: services.diagnosticRecorder, audit: services.audit }, { customerId: session.customerId, sessionId: (await params).sessionId, actor: { type: "admin", id: session.userId, email: session.email } }); return NextResponse.json(result.body, { status: result.status, headers }); }
