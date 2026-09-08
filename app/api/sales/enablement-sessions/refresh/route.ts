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
  const rawOffset = query.get("offset");
  const rawLimit = query.get("limit");
  const offset = rawOffset === null ? 0 : Number(rawOffset);
  const limit = rawLimit === null ? 25 : Number(rawLimit);
  const targetIds = query.getAll("targetId");
  const result = await handleRefreshSalesSessions({
    sessions: createPrismaSalesDemoSessionRepository(services.prisma),
    delivery: createCloudShareSalesDelivery(services.cloudshareClientFactory.forConnection(connection, { scope: "customer_default", reason: "unanchored_support_read" })),
    diagnostics: services.diagnosticRecorder,
  }, { customerId: session.customerId, mode: query.get("mode") === "automatic" ? "automatic" : "manual", offset, limit, ...(targetIds.length ? { targetIds } : {}) });
  return NextResponse.json(result.body, { status: result.status });
}
