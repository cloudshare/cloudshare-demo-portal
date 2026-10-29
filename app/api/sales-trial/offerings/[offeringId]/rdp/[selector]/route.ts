import { serveSalesTrialRdp } from "@/web/sales-trial-rdp-route";
export async function GET(_request: Request, { params }: { params: Promise<{ offeringId: string; selector: string }> }) {
 const { offeringId, selector } = await params;
 return serveSalesTrialRdp(offeringId, selector);
}
