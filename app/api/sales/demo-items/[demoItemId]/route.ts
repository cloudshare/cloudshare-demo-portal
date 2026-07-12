import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handleUpdateSalesDemoItem } from "@/api/sales-demo-items";
import { createPrismaDemoItemRepository } from "@/persistence/prisma-demo-item-repository";
export async function PUT(request: Request, { params }: { params: Promise<{ demoItemId: string }> }) { const services = getServices(); const session = await getPortalAdminSession(services, (await cookies()).get(PORTAL_SESSION_COOKIE)?.value); if (!session || (session.workspace !== "sales" && session.workspace !== "both")) return NextResponse.json({ error: "unauthorized" }, { status: 401 }); let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); } const result = await handleUpdateSalesDemoItem({ repository: createPrismaDemoItemRepository(services.prisma), connections: services.cloudshareConnections, cloudshare: services.cloudshareClientFactory, diagnostics: services.diagnosticRecorder }, { customerId: session.customerId, actor: { type: "admin", id: session.userId, email: session.email }, id: (await params).demoItemId, body }); return NextResponse.json(result.body, { status: result.status }); }
