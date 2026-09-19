import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";

/** Read-only provider refresh; the canonical bounded GET remains local. */
export async function POST(_: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const services = getServices();
  await services.ensurePortalSeeded();
  const session = await getPortalAdminSession(services, (await cookies()).get(PORTAL_SESSION_COOKIE)?.value);
  const headers = { "Cache-Control": "no-store" };
  if (session?.workspace !== "sales") return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  const result = await services.salesParticipantExtension.refresh({ customerId: session.customerId, sessionId: (await params).sessionId, actor: { type: "admin", id: session.userId, email: session.email } });
  return NextResponse.json(result.body, { status: result.status, headers });
}
