import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handleListSalesProjectMembers } from "@/api/sales-project-members";
import { createPrismaItemRepository } from "@/persistence/prisma-item-repository";
import { createCloudShareProjectMemberSource } from "@/integrations/cloudshare/project-members";

export async function GET(request: Request) {
  const services = getServices();
  await services.ensurePortalSeeded();
  const session = await getPortalAdminSession(services, (await cookies()).get(PORTAL_SESSION_COOKIE)?.value);
  if (!session || session.workspace !== "sales") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const itemId = new URL(request.url).searchParams.get("itemId")?.trim();
  if (!itemId) return NextResponse.json({ error: "itemId is required" }, { status: 400 });
  const result = await handleListSalesProjectMembers({
    items: createPrismaItemRepository(services.prisma), connections: services.cloudshareConnections,
    sourceFactory: { forConnection: (connection) => createCloudShareProjectMemberSource(services.cloudshareClientFactory.forConnection(connection)) },
    diagnostics: services.diagnosticRecorder, audit: services.audit,
  }, { customerId: session.customerId, actor: { type: "admin", id: session.userId, email: session.email }, itemId });
  return NextResponse.json(result.body, { status: result.status });
}
