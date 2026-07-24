import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handleReadSalesSessionWorkspace } from "@/api/sales-session-workspace";
import { createPrismaSalesSessionWorkspaceRepository } from "@/persistence/prisma-sales-session-workspace-repository";

/** GET is an ordinary metadata-only local read; protected evidence remains in Sales Support. */
export async function GET(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const services = getServices();
  await services.ensurePortalSeeded();
  const session = await getPortalAdminSession(services, (await cookies()).get(PORTAL_SESSION_COOKIE)?.value);
  if (!session || session.role !== "admin" || session.workspace !== "sales") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await handleReadSalesSessionWorkspace({ workspace: createPrismaSalesSessionWorkspaceRepository(services.prisma) }, { customerId: session.customerId, sessionId: (await params).sessionId });
  return NextResponse.json(result.body, { status: result.status });
}
