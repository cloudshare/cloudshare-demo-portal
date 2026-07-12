import { NextResponse } from "next/server";
import { handleUpdateOpportunityContact } from "@/api/sales-records";
import { getSalesRouteContext, isRouteResponse, parseJson } from "@/api/sales-route";
export async function PATCH(request: Request, context: { params: Promise<{ contactId: string }> }) {
  const route = await getSalesRouteContext(); if (isRouteResponse(route)) return route;
  const body = await parseJson(request); if (isRouteResponse(body)) return body;
  const { contactId } = await context.params;
  const response = await handleUpdateOpportunityContact(route.deps, { customerId: route.customerId, actor: route.actor, contactId, body });
  return NextResponse.json(response.body, { status: response.status });
}
