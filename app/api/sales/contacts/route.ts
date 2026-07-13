import { NextResponse } from "next/server";
import { handleCreateOpportunityContact } from "@/api/sales-records";
import { getSalesRouteContext, isRouteResponse, parseJson } from "@/api/sales-route";
export async function POST(request: Request) {
  const context = await getSalesRouteContext(); if (isRouteResponse(context)) return context;
  const body = await parseJson(request); if (isRouteResponse(body)) return body;
  const response = await handleCreateOpportunityContact(context.deps, { customerId: context.customerId, actor: context.actor, body });
  return NextResponse.json(response.body, { status: response.status });
}
