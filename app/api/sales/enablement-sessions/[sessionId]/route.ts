import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handleUpdateSalesSession } from "@/api/sales-session-edit";

export async function PUT(request: Request, { params }: { params: Promise<{ sessionId: string }> }) { const services = getServices(); await services.ensurePortalSeeded(); const session = await getPortalAdminSession(services, (await cookies()).get(PORTAL_SESSION_COOKIE)?.value); if (!session || session.workspace !== "sales") return NextResponse.json({ error: "unauthorized" }, { status: 401 }); let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); } const result = await handleUpdateSalesSession({}, { customerId: session.customerId, sessionId: (await params).sessionId, actor: { type: "admin", id: session.userId, email: session.email }, body }); return NextResponse.json(result.body, { status: result.status }); }
