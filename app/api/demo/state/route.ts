import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import {
  handleGetDemoState,
  buildDemoDeps,
} from "@/api/legacy-simulator-demo-control";

/** GET /api/demo/state — returns the current Demo Control Panel state. */
export async function GET() {
  const svc = getServices();
  const resp = await handleGetDemoState(buildDemoDeps(svc));
  return NextResponse.json(resp.body, { status: resp.status });
}
