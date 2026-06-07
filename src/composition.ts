import { PrismaClient } from "@prisma/client";
import { loadConfig, secretValues, type Config } from "@/config";
import { createLogger, type Logger } from "@/observability/logger";
import {
  createHeartbeatRepository,
  type HeartbeatRepository,
} from "@/persistence/heartbeat-repository";

/**
 * Composition root. The framework-agnostic modules are pure and dependency-free;
 * this is the one place that loads real config (failing fast at boot), constructs
 * the Prisma client and logger, and exposes them to the Next.js route handlers.
 *
 * A single set of instances is reused across requests to avoid exhausting the
 * SQLite connection pool during development hot-reloads.
 */

export interface Services {
  config: Config;
  logger: Logger;
  prisma: PrismaClient;
  heartbeats: HeartbeatRepository;
}

const globalForServices = globalThis as unknown as {
  __portalServices?: Services;
};

export function getServices(): Services {
  if (globalForServices.__portalServices) {
    return globalForServices.__portalServices;
  }

  const config = loadConfig(process.env);
  const logger = createLogger({ secrets: secretValues(config) });
  const prisma = new PrismaClient();
  const heartbeats = createHeartbeatRepository(prisma);

  const services: Services = { config, logger, prisma, heartbeats };
  globalForServices.__portalServices = services;
  return services;
}
