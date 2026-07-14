import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAdminExamAuthoringServices, getPortalSessionServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { buildAdminExamAuthoringDeps, handleGetExamAuthoringBootstrap } from "@/api/admin-exams";
export async function GET(request: Request) { const session = await getPortalAdminSession(getPortalSessionServices(), (await cookies()).get(PORTAL_SESSION_COOKIE)?.value); if (!session || (session.workspace !== "sales" && session.workspace !== "both")) return NextResponse.json({ error: "unauthorized" }, { status: 401 }); const result = await handleGetExamAuthoringBootstrap({ ...buildAdminExamAuthoringDeps(getAdminExamAuthoringServices()), diagnosticSource: "sales-items" }, { customerId: session.customerId, refresh: new URL(request.url).searchParams.get("refresh") === "true" }); return NextResponse.json(result.body, { status: result.status }); }
