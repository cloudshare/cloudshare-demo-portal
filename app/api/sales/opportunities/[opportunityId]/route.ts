import { NextResponse } from "next/server";
import { handleUpdateSalesOpportunity } from "@/api/sales-records";
import { getSalesRouteContext, isRouteResponse, parseJson } from "@/api/sales-route";
export async function PATCH(request: Request, context: { params: Promise<{ opportunityId: string }> }) {
  const route = await getSalesRouteContext(); if (isRouteResponse(route)) return route;
  const body = await parseJson(request); if (isRouteResponse(body)) return body;
  const { opportunityId } = await context.params;
  const response = await handleUpdateSalesOpportunity(route.deps, { customerId: route.customerId, actor: route.actor, opportunityId, body });
  return NextResponse.json(response.body, { status: response.status });
}
