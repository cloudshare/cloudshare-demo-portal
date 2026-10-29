import { salesTrialRdpHttpResponse } from "@/api/sales-trial-rdp-http";
import { serveSalesTrialRdp } from "@/web/sales-trial-rdp-route";
export async function POST(request: Request, { params }: { params: Promise<{ offeringId: string; selector: string }> }) {
 const { offeringId, selector } = await params;
 return serveSalesTrialRdp(offeringId, selector, request);
}

function methodNotAllowed(): Response {
 const response = salesTrialRdpHttpResponse({ status: 405, body: { state: "unavailable", message: "Use Show credentials from your Sales Trial page." } });
 response.headers.set("allow", "POST");
 return response;
}
export const GET = methodNotAllowed;
export const HEAD = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
