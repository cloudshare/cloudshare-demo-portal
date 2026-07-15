import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { cookies } from "next/headers";
import { handleGetSalesTimezones, handleSaveSalesPreference } from "@/api/sales-timezones";
import { createPrismaSalesAdminPreferenceRepository, createPrismaSalesTimezoneCacheRepository } from "@/persistence/prisma-sales-timezone-repository";
import { createCloudShareTimezoneSource } from "@/integrations/cloudshare/timezones";

async function context() {
  const services = getServices(); await services.ensurePortalSeeded();
  const session = await getPortalAdminSession(services, (await cookies()).get(PORTAL_SESSION_COOKIE)?.value);
  return { services, session: session?.workspace === "sales" ? session : null };
}
function deps(services: ReturnType<typeof getServices>) { return { cache: createPrismaSalesTimezoneCacheRepository(services.prisma), preferences: createPrismaSalesAdminPreferenceRepository(services.prisma), connections: services.cloudshareConnections, timezoneSourceFactory: { forConnection: (connection: Parameters<typeof services.cloudshareClientFactory.forConnection>[0]) => createCloudShareTimezoneSource(services.cloudshareClientFactory.forConnection(connection)) } }; }

export async function GET() { const { services, session } = await context(); if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 }); const result = await handleGetSalesTimezones(deps(services), { customerId: session.customerId, userId: session.userId }); return NextResponse.json(result.body, { status: result.status }); }
export async function PUT(request: Request) { const { services, session } = await context(); if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 }); let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); } const result = await handleSaveSalesPreference(deps(services), { userId: session.userId, body }); return new NextResponse(null, { status: result.status }); }
