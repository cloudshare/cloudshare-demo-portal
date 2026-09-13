import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const services = getServices();
  await services.ensurePortalSeeded();
  const session = await getPortalAdminSession(services, (await cookies()).get(PORTAL_SESSION_COOKIE)?.value);
  if (!session || session.role !== "admin" || session.workspace !== "sales") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  const ids = body && typeof body === "object" && Array.isArray((body as { opportunityContactIds?: unknown }).opportunityContactIds) ? (body as { opportunityContactIds: unknown[] }).opportunityContactIds.filter((id): id is string => typeof id === "string") : [];
  if (!services.salesParticipantWorkspace.registerParticipants) return NextResponse.json({ error: "Participant registration is unavailable." }, { status: 503 });
  const result = await services.salesParticipantWorkspace.registerParticipants({ customerId: session.customerId, sessionId: (await params).sessionId, actor: { type: "admin", id: session.userId, email: session.email }, opportunityContactIds: ids });
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
