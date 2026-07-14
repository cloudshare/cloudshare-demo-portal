import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAdminExamAuthoringServices, getPortalSessionServices, getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { buildAdminExamAuthoringDeps, handleGetProjectResources } from "@/api/admin-exams";
import { createCloudShareExamAuthoringSource, type CloudShareExamAuthoringSource } from "@/integrations/cloudshare/resources";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await getPortalAdminSession(getPortalSessionServices(), (await cookies()).get(PORTAL_SESSION_COOKIE)?.value);
  if (!session || (session.workspace !== "sales" && session.workspace !== "both")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const projectId = (await params).projectId;
  const result = await handleGetProjectResources({ ...buildAdminExamAuthoringDeps(getAdminExamAuthoringServices()), diagnosticSource: "sales-items" }, { customerId: session.customerId, projectId, refresh: new URL(request.url).searchParams.get("refresh") === "true" });
  if (result.status !== 200) return NextResponse.json(result.body, { status: result.status });
  const services = getServices();
  const connection = await services.cloudshareConnections.findByCustomerId(session.customerId);
  if (!connection) return NextResponse.json({ error: "Save a Certalis CloudShare Connection before authoring Items." }, { status: 404 });
  try {
    const candidate = services.cloudshareClientFactory.forConnection(connection) as unknown;
    const source: CloudShareExamAuthoringSource = typeof candidate === "object" && candidate !== null && "getBlueprintDetail" in candidate
      ? candidate as CloudShareExamAuthoringSource
      : createCloudShareExamAuthoringSource(candidate as Parameters<typeof createCloudShareExamAuthoringSource>[0]);
    const body = result.body as { blueprints: Array<{ id: string; name: string; description?: string }> };
    const details = await Promise.all(body.blueprints.map((blueprint) => source.getBlueprintDetail(projectId, blueprint.id)));
    return NextResponse.json({ ...body, blueprints: body.blueprints.map((blueprint, index) => ({ ...blueprint, defaultSnapshotRegionIds: details[index]?.snapshots.find((snapshot) => snapshot.isDefault)?.regionIds ?? [] })) }, { status: result.status });
  } catch {
    return NextResponse.json({ error: "CloudShare Blueprint detail validation failed. Review support diagnostics." }, { status: 502 });
  }
}
