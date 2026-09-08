import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handleRefreshSalesSessions } from "@/api/sales-session-refresh";
import { createPrismaSalesDemoSessionRepository } from "@/persistence/prisma-sales-demo-session-repository";
import { createCloudShareSalesDelivery } from "@/integrations/cloudshare/sales-delivery";

export async function POST(request: Request) {
  const services = getServices();
  const session = await getPortalAdminSession(services, (await cookies()).get(PORTAL_SESSION_COOKIE)?.value);
  if (!session || session.workspace !== "sales") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const connection = await services.cloudshareConnections.findByCustomerId(session.customerId);
  if (!connection) return NextResponse.json({ error: "CloudShare Connection is not configured." }, { status: 404 });
  const query = new URL(request.url).searchParams;
  const result = await handleRefreshSalesSessions({
    sessions: createPrismaSalesDemoSessionRepository(services.prisma),
    delivery: createCloudShareSalesDelivery(services.cloudshareClientFactory.forConnection(connection, { scope: "customer_default", reason: "unanchored_support_read" })),
  }, { customerId: session.customerId, mode: query.get("mode") === "automatic" ? "automatic" : "manual", offset: Math.max(0, Number(query.get("offset") ?? 0) || 0), limit: Math.min(100, Math.max(1, Number(query.get("limit") ?? 25) || 25)) });
  return NextResponse.json(result.body, { status: result.status });
}
