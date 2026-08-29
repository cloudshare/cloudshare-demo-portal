import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handleListPublishedSalesTrialOfferings } from "@/api/sales-trial-offerings";
import { createPrismaSalesTrialOfferingRepository } from "@/persistence/prisma-sales-trial-offering-repository";

export async function GET() {
  const services = getServices();
  await services.ensurePortalSeeded();
  const session = await getPortalSession(
    services,
    (await cookies()).get(PORTAL_SESSION_COOKIE)?.value,
  );
  if (!session || session.role !== "sales_trial_participant") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await handleListPublishedSalesTrialOfferings(
    { offerings: createPrismaSalesTrialOfferingRepository(services.prisma) },
    { customerId: session.customerId },
  );
  return NextResponse.json(result.body, { status: result.status });
}
