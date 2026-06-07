import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import { checkHealth } from "@/domain/health";

/**
 * Walking-skeleton tracer endpoint. Delegates to the framework-agnostic
 * `checkHealth` use case, which reads config, logs, and round-trips a record
 * through persistence — proving every layer is wired together.
 */
export async function GET() {
  const { config, logger, heartbeats } = getServices();

  const result = await checkHealth({
    mode: config.runtime.mode,
    logger,
    heartbeats,
  });

  return NextResponse.json(result);
}
