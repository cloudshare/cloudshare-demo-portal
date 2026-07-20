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
import { handleListSalesSessionParticipants, handleRegisterSalesSessionParticipants } from "@/api/sales-session-participants";

async function context() { const services = getServices(); await services.ensurePortalSeeded(); const session = await getPortalAdminSession(services, (await cookies()).get(PORTAL_SESSION_COOKIE)?.value); return { services, session: session?.workspace === "sales" ? session : null }; }
function deps(services: ReturnType<typeof getServices>) { return { sessions: createPrismaSalesDemoSessionRepository(services.prisma), items: createPrismaItemRepository(services.prisma), records: createPrismaSalesRecordRepository(services.prisma), participants: createPrismaSalesSessionParticipantRepository(services.prisma), connections: services.cloudshareConnections, deliveryFactory: { forConnection: (connection: Parameters<typeof services.cloudshareClientFactory.forConnection>[0]) => createCloudShareSalesDelivery(services.cloudshareClientFactory.forConnection(connection)) }, salesEnvironmentFactory: { forConnection: (connection: Parameters<typeof services.cloudshareClientFactory.forConnection>[0]) => createCloudShareSalesEnvironmentSource(services.cloudshareClientFactory.forConnection(connection)) }, diagnostics: services.diagnosticRecorder, audit: services.audit }; }
export async function GET(_: Request, { params }: { params: Promise<{ sessionId: string }> }) { const { services, session } = await context(); if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 }); const result = await handleListSalesSessionParticipants(deps(services), { customerId: session.customerId, sessionId: (await params).sessionId, actor: { type: "admin", id: session.userId, email: session.email } }); return NextResponse.json(result.body, { status: result.status }); }
export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) { const { services, session } = await context(); if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 }); let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); } const result = await handleRegisterSalesSessionParticipants(deps(services), { customerId: session.customerId, sessionId: (await params).sessionId, actor: { type: "admin", id: session.userId, email: session.email }, body }); return NextResponse.json(result.body, { status: result.status }); }
