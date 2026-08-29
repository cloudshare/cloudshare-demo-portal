import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import {
  handleCreateSalesTrialOffering,
  handleListSalesTrialOfferings,
} from "@/api/sales-trial-offerings";
import { createPrismaItemRepository } from "@/persistence/prisma-item-repository";
import { createPrismaSalesTrialOfferingRepository } from "@/persistence/prisma-sales-trial-offering-repository";
import { createPrismaSalesTimezoneCacheRepository } from "@/persistence/prisma-sales-timezone-repository";

async function context() {
  const services = getServices();
  await services.ensurePortalSeeded();
  const session = await getPortalAdminSession(
    services,
    (await cookies()).get(PORTAL_SESSION_COOKIE)?.value,
  );
  return { services, session: session?.workspace === "sales" ? session : null };
}

export async function GET() {
  const { services, session } = await context();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await handleListSalesTrialOfferings(
    { offerings: createPrismaSalesTrialOfferingRepository(services.prisma) },
    { customerId: session.customerId },
  );
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(request: Request) {
  const { services, session } = await context();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const result = await handleCreateSalesTrialOffering(
    {
      offerings: createPrismaSalesTrialOfferingRepository(services.prisma),
      items: createPrismaItemRepository(services.prisma),
      connections: services.cloudshareConnections,
      timezones: createPrismaSalesTimezoneCacheRepository(services.prisma),
      diagnostics: services.diagnosticRecorder,
      audit: services.audit,
    },
    {
      customerId: session.customerId,
      actor: { type: "admin", id: session.userId, email: session.email },
      body,
    },
  );
  return NextResponse.json(result.body, { status: result.status });
}
