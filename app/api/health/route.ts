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

  try {
    const result = await checkHealth({
      mode: config.runtime.mode,
      logger,
      heartbeats,
    });
    return NextResponse.json(result);
  } catch (err) {
    logger.error("health check failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { status: "error", message: "health check failed" },
      { status: 500 },
    );
  }
}
