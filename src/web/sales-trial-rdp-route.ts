import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handleSalesTrialRdpHttp, handleSalesTrialCredentialsHttp, salesTrialRdpHttpResponse } from "@/api/sales-trial-rdp-http";
import { createPrismaSalesTrialOfferingRepository } from "@/persistence/prisma-sales-trial-offering-repository";
import { createPrismaItemRepository } from "@/persistence/prisma-item-repository";
/** Both routes share the same authenticated, Customer-scoped download gate. */
export async function serveSalesTrialRdp(offeringId: string, selector?: string, credentialRequest?: Request) {
 try {
  const services = getServices();
  const session = await getPortalSession(services, (await cookies()).get(PORTAL_SESSION_COOKIE)?.value);
  const deps = { offerings: createPrismaSalesTrialOfferingRepository(services.prisma), enrollments: services.salesTrialEnrollments, items: createPrismaItemRepository(services.prisma), connections: services.cloudshareConnections, cloudshare: services.cloudshareClientFactory, diagnostics: services.diagnosticRecorder, audit: services.audit };
  return credentialRequest ? await handleSalesTrialCredentialsHttp(deps, session, offeringId, selector ?? "", credentialRequest) : await handleSalesTrialRdpHttp(deps, session, offeringId, selector);
 } catch {
  return salesTrialRdpHttpResponse({ status: 503, body: { state: "unavailable", message: "Remote desktop is temporarily unavailable. Try again later." } });
 }
}
