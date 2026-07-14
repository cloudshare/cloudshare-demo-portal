import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handleCreateSalesItem, handleListSalesItems } from "@/api/sales-items";
import { createPrismaItemRepository } from "@/persistence/prisma-item-repository";

async function salesSession() { const services = getServices(); const session = await getPortalAdminSession(services, (await cookies()).get(PORTAL_SESSION_COOKIE)?.value); return { services, session: session && (session.workspace === "sales" || session.workspace === "both") ? session : null }; }
export async function GET() { const { services, session } = await salesSession(); if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 }); const result = await handleListSalesItems({ repository: createPrismaItemRepository(services.prisma) }, { customerId: session.customerId }); return NextResponse.json(result.body, { status: result.status }); }
export async function POST(request: Request) { const { services, session } = await salesSession(); if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 }); let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); } const result = await handleCreateSalesItem({ repository: createPrismaItemRepository(services.prisma), connections: services.cloudshareConnections, cloudshare: services.cloudshareClientFactory, diagnostics: services.diagnosticRecorder, audit: services.audit }, { customerId: session.customerId, actor: { type: "admin", id: session.userId, email: session.email }, body }); return NextResponse.json(result.body, { status: result.status }); }
