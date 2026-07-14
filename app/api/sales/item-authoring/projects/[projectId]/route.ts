import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAdminExamAuthoringServices, getPortalSessionServices, getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { buildAdminExamAuthoringDeps, handleGetProjectResources } from "@/api/admin-exams";
import { handleGetSalesItemBlueprintDetails } from "@/api/sales-items";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await getPortalAdminSession(getPortalSessionServices(), (await cookies()).get(PORTAL_SESSION_COOKIE)?.value);
  if (!session || (session.workspace !== "sales" && session.workspace !== "both")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const projectId = (await params).projectId;
  const result = await handleGetProjectResources({ ...buildAdminExamAuthoringDeps(getAdminExamAuthoringServices()), diagnosticSource: "sales-items" }, { customerId: session.customerId, projectId, refresh: new URL(request.url).searchParams.get("refresh") === "true" });
  if (result.status !== 200) return NextResponse.json(result.body, { status: result.status });
  const services = getServices();
  const body = result.body as { blueprints: Array<{ id: string; name: string; description?: string }> };
  const details = await handleGetSalesItemBlueprintDetails({ connections: services.cloudshareConnections, cloudshare: services.cloudshareClientFactory, diagnostics: services.diagnosticRecorder }, { customerId: session.customerId, actor: { type: "admin", id: session.userId, email: session.email }, projectId, blueprintIds: body.blueprints.map((blueprint) => blueprint.id) });
  if (details.status !== 200) return NextResponse.json(details.body, { status: details.status });
  const blueprintDetails = details.body.blueprintDetails as Array<{ id: string; defaultSnapshotRegionIds: string[] }>;
  return NextResponse.json({ ...body, blueprints: body.blueprints.map((blueprint) => ({ ...blueprint, defaultSnapshotRegionIds: blueprintDetails.find((detail) => detail.id === blueprint.id)?.defaultSnapshotRegionIds ?? [] })) }, { status: result.status });
}
