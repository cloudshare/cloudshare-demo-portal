import { NextResponse } from "next/server";
import { handleUpdateSalesAccount } from "@/api/sales-records";
import { getSalesRouteContext, isRouteResponse, parseJson } from "@/api/sales-route";
export async function PATCH(request: Request, context: { params: Promise<{ accountId: string }> }) {
  const route = await getSalesRouteContext(); if (isRouteResponse(route)) return route;
  const body = await parseJson(request); if (isRouteResponse(body)) return body;
  const { accountId } = await context.params;
  const response = await handleUpdateSalesAccount(route.deps, { customerId: route.customerId, actor: route.actor, accountId, body });
  return NextResponse.json(response.body, { status: response.status });
}
