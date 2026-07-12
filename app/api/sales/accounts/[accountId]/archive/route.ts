import { NextResponse } from "next/server";
import { handleArchiveSalesAccount } from "@/api/sales-records";
import { getSalesRouteContext, isRouteResponse } from "@/api/sales-route";
export async function POST(_request: Request, context: { params: Promise<{ accountId: string }> }) {
  const route = await getSalesRouteContext(); if (isRouteResponse(route)) return route;
  const { accountId } = await context.params;
  const response = await handleArchiveSalesAccount(route.deps, { customerId: route.customerId, actor: route.actor, accountId });
  return NextResponse.json(response.body, { status: response.status });
}
