import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import {
  handleExecuteStep,
  buildDemoDeps,
} from "@/api/legacy-simulator-demo-control";

/** POST /api/demo/step — execute one happy-path demo step by name. */
export async function POST(request: Request) {
  const svc = getServices();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const resp = await handleExecuteStep(buildDemoDeps(svc), { body });
  return NextResponse.json(resp.body, { status: resp.status });
}
