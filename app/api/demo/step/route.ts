import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import { handleExecuteStep } from "@/api/demo-control";

/** POST /api/demo/step — execute one happy-path demo step by name. */
export async function POST(request: Request) {
  const svc = getServices();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const resp = await handleExecuteStep(
    {
      logger: svc.logger,
      examAttempts: svc.examAttempts,
      labLaunches: svc.labLaunches,
      environmentSource: svc.environmentSource,
      kryterion: svc.kryterion,
      completedDemoSteps: svc.completedDemoSteps,
      genesys: svc.genesys,
      events: svc.events,
      labProvisioner: svc.labProvisioner,
      environmentSimulator: svc.environmentSimulator,
      scoreRetriever: svc.scoreRetriever,
      resetDemoState: svc.resetDemo,
      newId: () => randomUUID(),
      now: () => new Date(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    },
    { body },
  );
  return NextResponse.json(resp.body, { status: resp.status });
}
