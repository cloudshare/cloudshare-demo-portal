import { NextResponse } from "next/server";
import { handleArchiveOpportunityContact } from "@/api/sales-records";
import { getSalesRouteContext, isRouteResponse } from "@/api/sales-route";

export async function POST(_request: Request, context: { params: Promise<{ contactId: string }> }) {
  const salesContext = await getSalesRouteContext(); if (isRouteResponse(salesContext)) return salesContext;
  const { contactId } = await context.params;
  const response = await handleArchiveOpportunityContact(salesContext.deps, { customerId: salesContext.customerId, actor: salesContext.actor, contactId });
  return NextResponse.json(response.body, { status: response.status });
}
