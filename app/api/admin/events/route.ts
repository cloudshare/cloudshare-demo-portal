import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import { handleGetEventLog } from "@/api/admin";

/** GET /api/admin/events?limit=<n> — returns the integration event log, newest-first. */
export async function GET(request: Request) {
  const { eventLog, logger } = getServices();
  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());

  const resp = await handleGetEventLog({ eventLog, logger }, { query });
  return NextResponse.json(resp.body, { status: resp.status });
}
