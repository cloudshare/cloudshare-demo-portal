import { serveSalesTrialRdp } from "@/web/sales-trial-rdp-route";
export async function GET(_request: Request, { params }: { params: Promise<{ offeringId: string }> }) {
 return serveSalesTrialRdp((await params).offeringId);
}
