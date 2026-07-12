import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { createPrismaSalesRecordRepository } from "@/persistence/prisma-sales-record-repository";
import type { SalesRecordsDeps } from "@/api/sales-records";

export async function getSalesRouteContext(): Promise<{ readonly deps: SalesRecordsDeps; readonly customerId: string; readonly actor: { readonly type: string; readonly id: string; readonly email: string } } | NextResponse> {
  const services = getServices();
  await services.ensurePortalSeeded();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalAdminSession(services, sessionId);
  if (!session || session.workspace !== "sales") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return {
    deps: { records: createPrismaSalesRecordRepository(services.prisma), audit: services.audit, diagnostics: services.diagnosticRecorder, logger: services.logger },
    customerId: session.customerId,
    actor: { type: "admin", id: session.userId, email: session.email },
  };
}

export function isRouteResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}

export async function parseJson(request: Request): Promise<unknown | NextResponse> {
  try { return await request.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
}
