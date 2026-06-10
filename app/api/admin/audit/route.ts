import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import { handleGetAuditTrail } from "@/api/admin";

/** GET /api/admin/audit?examAttemptId=<id> — returns audit records, optionally filtered. */
export async function GET(request: Request) {
  const { audit, logger } = getServices();
  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());

  const resp = await handleGetAuditTrail({ audit, logger }, { query });
  return NextResponse.json(resp.body, { status: resp.status });
}
