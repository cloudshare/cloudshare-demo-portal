import { NextResponse } from "next/server";
import { handleCreateSalesAccount, handleListSalesRecords } from "@/api/sales-records";
import { getSalesRouteContext, isRouteResponse, parseJson } from "@/api/sales-route";

export async function GET(request: Request) {
  const context = await getSalesRouteContext(); if (isRouteResponse(context)) return context;
  const search = new URL(request.url).searchParams.get("search") ?? undefined;
  const response = await handleListSalesRecords(context.deps, { customerId: context.customerId, actor: context.actor, search });
  return NextResponse.json(response.body, { status: response.status });
}
export async function POST(request: Request) {
  const context = await getSalesRouteContext(); if (isRouteResponse(context)) return context;
  const body = await parseJson(request); if (isRouteResponse(body)) return body;
  const response = await handleCreateSalesAccount(context.deps, { customerId: context.customerId, actor: context.actor, body });
  return NextResponse.json(response.body, { status: response.status });
}
