import type { Logger } from "@/observability/logger";
import type { HeartbeatRepository } from "@/persistence/heartbeat-repository";
import type { PortalMode } from "@/config";

/**
 * The walking-skeleton tracer: a single end-to-end path that cuts through every
 * layer — it reads runtime config (mode), writes a structured log line, and
 * round-trips a record through the persistence seam. It proves the modules are
 * wired together correctly before any real domain behaviour is built on top.
 *
 * It depends only on framework-agnostic interfaces, so it carries no Next.js
 * imports and is exercised directly in unit tests.
 */

export interface HealthDeps {
  mode: PortalMode;
  logger: Logger;
  heartbeats: HeartbeatRepository;
}

export interface HealthResult {
  status: "ok";
  mode: PortalMode;
  heartbeatId: string;
  persistenceVerified: boolean;
}

export async function checkHealth(deps: HealthDeps): Promise<HealthResult> {
  const { mode, logger, heartbeats } = deps;

  const saved = await heartbeats.record("api/health");
  const readBack = await heartbeats.findById(saved.id);
  const persistenceVerified = readBack?.id === saved.id;

  logger.info("health check", {
    mode,
    heartbeatId: saved.id,
    persistenceVerified,
  });

  return {
    status: "ok",
    mode,
    heartbeatId: saved.id,
    persistenceVerified,
  };
}
