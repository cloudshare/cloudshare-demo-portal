import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import { handleResetDemo } from "@/api/demo-control";

/** POST /api/demo/reset — reset all in-memory demo state for a clean repeat run. */
export async function POST() {
  const svc = getServices();
  const resp = await handleResetDemo({
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
  });
  return NextResponse.json(resp.body, { status: resp.status });
}
