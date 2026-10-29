import { handleSalesTrialRdp, type SalesTrialRdpDeps, type TrialRdpResult } from "./sales-trial-rdp";
import type { PortalSession } from "@/auth/portal-stores";
export function salesTrialRdpHttpResponse(result: TrialRdpResult): Response {
 const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
 if (result.file !== undefined && result.status === 200) return new Response(result.file, { status: 200, headers: { ...headers, "content-type": "application/rdp", "content-disposition": 'attachment; filename="trial-desktop.rdp"' } });
 return Response.json(result.body ?? { state: "unavailable" }, { status: result.status, headers });
}
export async function handleSalesTrialRdpHttp(deps: SalesTrialRdpDeps, session: PortalSession | null, offeringId: string, selector?: string): Promise<Response> {
 if (!session || session.role !== "sales_trial_participant") return salesTrialRdpHttpResponse({ status: 401, body: { state: "unavailable", message: "Sign in to your Sales Trial account." } });
 return salesTrialRdpHttpResponse(await handleSalesTrialRdp(deps, { customerId: session.customerId, userId: session.userId, email: session.email, offeringId, selector }));
}
