import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { createPrismaSalesSessionConfigurationRepository } from "@/persistence/prisma-sales-session-configuration-repository";
import { handleGetSalesSessionConfiguration, handleSaveSalesSessionConfiguration } from "@/api/sales-session-configuration";
async function context() { const services = getServices(); await services.ensurePortalSeeded(); const session = await getPortalAdminSession(services, (await cookies()).get(PORTAL_SESSION_COOKIE)?.value); return { services, session: session?.workspace === "sales" ? session : null }; }
export async function GET() { const { services, session } = await context(); if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 }); const result = await handleGetSalesSessionConfiguration({ settings: createPrismaSalesSessionConfigurationRepository(services.prisma) }, { customerId: session.customerId }); return NextResponse.json(result.body, { status: result.status }); }
export async function PUT(request: Request) { const { services, session } = await context(); if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 }); const body = await request.json().catch(() => null); const result = await handleSaveSalesSessionConfiguration({ settings: createPrismaSalesSessionConfigurationRepository(services.prisma) }, { customerId: session.customerId, body }); return NextResponse.json(result.body, { status: result.status }); }
