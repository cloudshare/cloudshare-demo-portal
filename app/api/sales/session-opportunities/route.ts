import { NextResponse } from "next/server";
import { getSalesRouteContext, isRouteResponse } from "@/api/sales-route";
import { handleListSalesSessionOpportunities } from "@/api/sales-session-opportunities";
import { getServices } from "@/composition";
import { createPrismaSalesSessionOpportunityQuery } from "@/persistence/prisma-sales-session-opportunity-query";
export async function GET(request: Request) { const context = await getSalesRouteContext(); if (isRouteResponse(context)) return context; const query = new URL(request.url).searchParams; const result = await handleListSalesSessionOpportunities({ query: createPrismaSalesSessionOpportunityQuery(getServices().prisma) }, { customerId: context.customerId, accountId: query.get("accountId"), search: query.get("search"), page: query.get("page"), pageSize: query.get("pageSize") }); return NextResponse.json(result.body, { status: result.status }); }
