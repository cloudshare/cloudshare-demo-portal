import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handleReadSalesSessionWorkspace } from "@/api/sales-session-workspace";
import { createPrismaSalesSessionWorkspaceRepository } from "@/persistence/prisma-sales-session-workspace-repository";

/** GET is an ordinary metadata-only local read; protected evidence remains in Sales Support. */
export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const services = getServices();
  const session = await getPortalAdminSession(services, (await cookies()).get(PORTAL_SESSION_COOKIE)?.value);
  if (!session || session.role !== "admin" || session.workspace !== "sales") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const query = new URL(request.url).searchParams;
  const participantPage = Number(query.get("participantPage") ?? "0");
  const participantPageSize = Number(query.get("participantPageSize") ?? "25");
  const requestInput = { customerId: session.customerId, sessionId: (await params).sessionId, ...(query.get("participantQuery") ? { participantQuery: query.get("participantQuery")! } : {}), ...(query.has("participantPage") ? { participantPage: Number.isFinite(participantPage) ? participantPage : 0 } : {}), ...(query.has("participantPageSize") ? { participantPageSize: Number.isFinite(participantPageSize) ? participantPageSize : 25 } : {}) };
  const result = await handleReadSalesSessionWorkspace({ workspace: createPrismaSalesSessionWorkspaceRepository(services.prisma) }, requestInput);
  return NextResponse.json(result.body, { status: result.status });
}
