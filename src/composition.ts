import { PrismaClient } from "@prisma/client";
import { loadConfig, secretValues, type Config } from "@/config";
import { createLogger, type Logger } from "@/observability/logger";
import {
  createHeartbeatRepository,
  type HeartbeatRepository,
} from "@/persistence/heartbeat-repository";
import {
  createTokenCandidateAuthenticator,
  createInMemoryConsumedTokenStore,
  createInMemoryCandidateSessionStore,
  type CandidateAuthenticator,
} from "@/auth";
import {
  createKryterionSimulator,
  type KryterionSimulator,
} from "@/integrations/kryterion/simulator";
import { createGenesysSimulator } from "@/integrations/genesys/simulator";
import { genesysDemoData } from "@/integrations/genesys/demo-data";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";
import { createInMemoryEventBus, type IntegrationEventBus } from "@/domain/event-bus";
import type { ExamEligibilityProvider } from "@/domain/eligibility";
import type { ExamAttemptRepository } from "@/domain/exam-attempt";

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
  candidateAuth: CandidateAuthenticator;
  kryterion: KryterionSimulator;
  genesys: ExamEligibilityProvider;
  examAttempts: ExamAttemptRepository;
  events: IntegrationEventBus;
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

  // Candidate identity. Stores are in-memory for the demo (they survive page
  // reloads within the running server); swap in Prisma-backed stores for a
  // deployment that must survive restarts.
  const candidateAuth = createTokenCandidateAuthenticator({
    secret: config.secrets.kryterionTokenSecret,
    consumedTokens: createInMemoryConsumedTokenStore(),
    sessions: createInMemoryCandidateSessionStore(),
  });
  const kryterion = createKryterionSimulator({
    secret: config.secrets.kryterionTokenSecret,
    ttlSeconds: 120,
  });

  // Eligibility & booking. The event bus carries the exam_attempt.created event
  // the downstream lab-launch flow (later slice) will subscribe to; a failing
  // subscriber is logged, not allowed to break publishing.
  const genesys = createGenesysSimulator(genesysDemoData);
  const examAttempts = createInMemoryExamAttemptRepository();
  const events = createInMemoryEventBus({
    onError: (error, event) =>
      logger.error("integration event handler failed", {
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
      }),
  });

  const services: Services = {
    config,
    logger,
    prisma,
    heartbeats,
    candidateAuth,
    kryterion,
    genesys,
    examAttempts,
    events,
  };
  globalForServices.__portalServices = services;
  return services;
}
