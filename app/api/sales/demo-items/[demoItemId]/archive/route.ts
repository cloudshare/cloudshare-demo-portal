import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handleArchiveSalesDemoItem } from "@/api/sales-demo-items";
import { createPrismaDemoItemRepository } from "@/persistence/prisma-demo-item-repository";
export async function POST(_: Request, { params }: { params: Promise<{ demoItemId: string }> }) { const services = getServices(); const session = await getPortalAdminSession(services, (await cookies()).get(PORTAL_SESSION_COOKIE)?.value); if (!session || (session.workspace !== "sales" && session.workspace !== "both")) return NextResponse.json({ error: "unauthorized" }, { status: 401 }); const result = await handleArchiveSalesDemoItem({ repository: createPrismaDemoItemRepository(services.prisma), diagnostics: services.diagnosticRecorder }, { customerId: session.customerId, actor: { type: "admin", id: session.userId, email: session.email }, id: (await params).demoItemId }); return NextResponse.json(result.body, { status: result.status }); }
