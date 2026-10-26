import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
const headers = { "Cache-Control": "no-store" };
async function context() {
  const services = getServices();
  await services.ensurePortalSeeded();
  const session = await getPortalAdminSession(services, (await cookies()).get(PORTAL_SESSION_COOKIE)?.value);
  return { services, session: session?.workspace === "sales" ? session : null };
}
export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { services, session } = await context();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers }); }
  const result = await services.salesSessionCancellation.submit({ customerId: session.customerId, sessionId: (await params).sessionId, actor: { type: "admin", id: session.userId, email: session.email }, body });
  return NextResponse.json(result.body, { status: result.status, headers });
}
export async function GET(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { services, session } = await context();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  const result = await services.salesSessionCancellation.latest(session.customerId, (await params).sessionId);
  return NextResponse.json(result?.body ?? null, { headers });
}
