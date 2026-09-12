import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handleReadSalesParticipantWorkspacePage } from "@/api/sales-participant-workspace";
import { createPrismaSalesParticipantWorkspaceReader } from "@/persistence/prisma-sales-participant-workspace-reader";
export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const services = getServices();
  const session = await getPortalAdminSession(services, (await cookies()).get(PORTAL_SESSION_COOKIE)?.value);
  if (!session || session.role !== "admin" || session.workspace !== "sales") return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const url = new URL(request.url);
  const result = await handleReadSalesParticipantWorkspacePage({ reader: createPrismaSalesParticipantWorkspaceReader(services.prisma) }, { customerId: session.customerId, sessionId: (await params).sessionId, query: url.searchParams.get("query") ?? undefined, offset: Number(url.searchParams.get("offset") ?? 0), limit: Number(url.searchParams.get("limit") ?? 25) });
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
