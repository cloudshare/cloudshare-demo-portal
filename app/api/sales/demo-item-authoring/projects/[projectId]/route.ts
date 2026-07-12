import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAdminExamAuthoringServices, getPortalSessionServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { buildAdminExamAuthoringDeps, handleGetProjectResources } from "@/api/admin-exams";
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) { const session = await getPortalAdminSession(getPortalSessionServices(), (await cookies()).get(PORTAL_SESSION_COOKIE)?.value); if (!session || (session.workspace !== "sales" && session.workspace !== "both")) return NextResponse.json({ error: "unauthorized" }, { status: 401 }); const result = await handleGetProjectResources(buildAdminExamAuthoringDeps(getAdminExamAuthoringServices()), { customerId: session.customerId, projectId: (await params).projectId, refresh: new URL(request.url).searchParams.get("refresh") === "true" }); return NextResponse.json(result.body, { status: result.status }); }
