import { NextResponse } from "next/server";
import { handleArchiveSalesOpportunity } from "@/api/sales-records";
import { getSalesRouteContext, isRouteResponse } from "@/api/sales-route";
export async function POST(_request: Request, context: { params: Promise<{ opportunityId: string }> }) {
  const route = await getSalesRouteContext(); if (isRouteResponse(route)) return route;
  const { opportunityId } = await context.params;
  const response = await handleArchiveSalesOpportunity(route.deps, { customerId: route.customerId, actor: route.actor, opportunityId });
  return NextResponse.json(response.body, { status: response.status });
}
