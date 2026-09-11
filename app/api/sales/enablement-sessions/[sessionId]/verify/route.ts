import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handleReconcileSalesSession } from "@/api/sales-session-reconciliation";
import { createPrismaSalesDemoSessionRepository } from "@/persistence/prisma-sales-demo-session-repository";

export async function POST(_: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const services = getServices(); const session = await getPortalAdminSession(services, (await cookies()).get(PORTAL_SESSION_COOKIE)?.value);
  if (!session || session.workspace !== "sales") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const connection = await services.cloudshareConnections.findByCustomerId(session.customerId); if (!connection) return NextResponse.json({ error: "CloudShare Connection is not configured." }, { status: 404 });
  const result = await handleReconcileSalesSession({ sessions: createPrismaSalesDemoSessionRepository(services.prisma), connections: services.cloudshareConnections, cloudshare: services.cloudshareClientFactory, diagnostics: services.diagnosticRecorder, audit: services.audit }, { customerId: session.customerId, sessionId: (await params).sessionId, actor: { type: "admin", id: session.userId, email: session.email } });
  return NextResponse.json(result.body, { status: result.status });
}
