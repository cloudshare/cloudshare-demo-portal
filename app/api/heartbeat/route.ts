import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import { handleHeartbeat } from "@/api/heartbeat";

/**
 * Client heartbeat endpoint. The candidate page POSTs here while a lab is
 * open so the server can detect inactivity and auto-suspend the environment.
 * The request body must contain `examAttemptId`.
 */
export async function POST(request: Request) {
  const { heartbeatAutoSuspend, logger } = getServices();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const resp = await handleHeartbeat({ autoSuspend: heartbeatAutoSuspend, logger }, { body });
  return NextResponse.json(resp.body, { status: resp.status });
}
