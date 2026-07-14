import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handleArchiveSalesItem } from "@/api/sales-items";
import { createPrismaItemRepository } from "@/persistence/prisma-item-repository";
export async function POST(_: Request, { params }: { params: Promise<{ itemId: string }> }) { const services = getServices(); const session = await getPortalAdminSession(services, (await cookies()).get(PORTAL_SESSION_COOKIE)?.value); if (!session || (session.workspace !== "sales" && session.workspace !== "both")) return NextResponse.json({ error: "unauthorized" }, { status: 401 }); const result = await handleArchiveSalesItem({ repository: createPrismaItemRepository(services.prisma), diagnostics: services.diagnosticRecorder, audit: services.audit }, { customerId: session.customerId, actor: { type: "admin", id: session.userId, email: session.email }, id: (await params).itemId }); return NextResponse.json(result.body, { status: result.status }); }
