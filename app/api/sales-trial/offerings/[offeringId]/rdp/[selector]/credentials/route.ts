import { serveSalesTrialRdp } from "@/web/sales-trial-rdp-route";
export async function POST(request: Request, { params }: { params: Promise<{ offeringId: string; selector: string }> }) {
 const { offeringId, selector } = await params;
 return serveSalesTrialRdp(offeringId, selector, request);
}
