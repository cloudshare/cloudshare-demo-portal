import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import { handleResetDemo, buildDemoDeps } from "@/api/demo-control";

/** POST /api/demo/reset — reset all in-memory demo state for a clean repeat run. */
export async function POST() {
  const svc = getServices();
  const resp = await handleResetDemo(buildDemoDeps(svc));
  return NextResponse.json(resp.body, { status: resp.status });
}
