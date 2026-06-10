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
import { createInMemoryLabLaunchRepository } from "@/persistence/lab-launch-repository";
import { createInMemoryEventBus, type IntegrationEventBus } from "@/domain/event-bus";
import { createCloudShareIntegration } from "@/integrations/cloudshare";
import { createCloudShareLabProvisioner } from "@/integrations/cloudshare/labs";
import { createCloudShareEnvironmentSource } from "@/integrations/cloudshare/environment";
import {
  createCloudShareEnvironmentSimulator,
  type CloudShareEnvironmentSimulator,
} from "@/integrations/cloudshare/environment-simulator";
import { createCloudShareEnvironmentController } from "@/integrations/cloudshare/environment-controller";
import { createInMemoryEnvironmentRepository } from "@/persistence/environment-repository";
import { createInMemoryWebhookIdempotencyStore } from "@/persistence/webhook-idempotency-store";
import {
  createHeartbeatAutoSuspend,
  type HeartbeatAutoSuspend,
} from "@/domain/heartbeat-auto-suspend";
import { suspendExam } from "@/domain/timer-sync";
import { type DemoStep } from "@/domain/demo-control";
import { createCloudShareGuidedJourneyProvider } from "@/integrations/cloudshare/guided-journey";
import { createCloudShareResourceLister } from "@/integrations/cloudshare/resources";
import { createInMemoryAuditRepository } from "@/persistence/audit-repository";
import { createInMemoryResourceRepository } from "@/persistence/resource-repository";
import { createInMemoryEventLogRepository } from "@/persistence/event-log-repository";
import type { ScoreRetrievalProvider } from "@/domain/score-result";
import type { ExamEligibilityProvider } from "@/domain/eligibility";
import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import type { LabProvisioner, LabLaunchRepository } from "@/domain/lab-launch";
import type { EnvironmentController, EnvironmentRepository, EnvironmentStateSource } from "@/domain/environment";
import type { WebhookIdempotencyStore } from "@/domain/webhook";
import type { AuditRepository } from "@/domain/audit-trail";
import type { ResourceRepository } from "@/domain/resource-sync";
import type { EventLogRepository } from "@/domain/event-log";
import type { CloudShareResourceLister } from "@/domain/resource-sync";

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
  labProvisioner: LabProvisioner;
  labLaunches: LabLaunchRepository;
  // Webhook receiver & polling source-of-truth (Slice 6).
  environments: EnvironmentRepository;
  /** Authoritative `GET environment` poll: the simulator in demo mode, CloudShare in live mode. */
  environmentSource: EnvironmentStateSource;
  /** Suspend/resume commands: the simulator in demo mode, the live controller in production. */
  environmentController: EnvironmentController;
  /** Present only in demo/fixture mode — the in-memory CloudShare stand-in that emits webhooks. */
  environmentSimulator: CloudShareEnvironmentSimulator | null;
  webhookIdempotency: WebhookIdempotencyStore;
  /** Tracks client heartbeats and auto-suspends inactive lab sessions. */
  heartbeatAutoSuspend: HeartbeatAutoSuspend;
  /** Retrieves per-participant Guided Journey progress from CloudShare. */
  scoreRetriever: ScoreRetrievalProvider;
  /** Audit trail — one record per significant portal action. */
  audit: AuditRepository;
  /** CloudShare resource ID↔name mappings, populated by the admin sync endpoint. */
  resources: ResourceRepository;
  /** All integration events received/emitted during this server instance's lifetime. */
  eventLog: EventLogRepository;
  /** Lists CloudShare blueprints, policies, projects, regions for admin sync. */
  resourceLister: CloudShareResourceLister;
  /**
   * Which demo steps have been explicitly completed in this server instance's
   * lifetime. Cleared by `resetDemo()` for repeat runs.
   */
  completedDemoSteps: ReadonlySet<DemoStep>;
  /** Record one completed demo step — the only external mutation path for completedDemoSteps. */
  markStepDone(step: DemoStep): void;
  /** Reset all demo in-memory state for a clean repeat run. */
  resetDemo(): void;
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
  // Each in-memory repo exposes reset() for the demo clean-slate operation.
  const examAttempts = createInMemoryExamAttemptRepository();
  const events = createInMemoryEventBus({
    onError: (error, event) =>
      logger.error("integration event handler failed", {
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
      }),
  });

  // CloudShare lab launch. The transport (live fetch vs fixture replay) is chosen
  // by PORTAL_MODE; the provisioner and launch flow are identical either way.
  const cloudshare = createCloudShareIntegration({
    mode: config.runtime.mode,
    v4: {
      clientId: config.secrets.cloudshareV4ClientId,
      clientSecret: config.secrets.cloudshareV4ClientSecret,
    },
    v3: {
      apiId: config.secrets.cloudshareV3ApiId,
      apiKey: config.secrets.cloudshareV3ApiKey,
    },
  });
  const labProvisioner = createCloudShareLabProvisioner(cloudshare);
  const labLaunches = createInMemoryLabLaunchRepository();

  // Webhook receiver & polling source-of-truth. In demo mode the simulator is BOTH
  // the webhook emitter, the authoritative poll target, AND the suspend/resume
  // command target — its emitted events, poll answers, and control commands all
  // share one in-memory truth. In live mode the poll and commands hit CloudShare.
  const environmentSimulator =
    config.runtime.mode === "fixture"
      ? createCloudShareEnvironmentSimulator({ secret: config.secrets.webhookSecret })
      : null;
  const environmentSource: EnvironmentStateSource =
    environmentSimulator ?? createCloudShareEnvironmentSource(cloudshare);
  const environmentController: EnvironmentController =
    environmentSimulator ?? createCloudShareEnvironmentController(cloudshare);
  const environments = createInMemoryEnvironmentRepository();
  const webhookIdempotency = createInMemoryWebhookIdempotencyStore();

  // Heartbeat auto-suspend. The suspend function is pre-bound to the current
  // service instances so HeartbeatAutoSuspend stays free of framework concerns.
  const heartbeatAutoSuspend = createHeartbeatAutoSuspend({
    timeoutMs: config.runtime.heartbeatTimeoutMs,
    logger,
    suspendFn: (examAttemptId) =>
      suspendExam(
        {
          controller: environmentController,
          source: environmentSource,
          timer: kryterion,
          launches: labLaunches,
          sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        },
        { examAttemptId },
      ),
  });
  heartbeatAutoSuspend.start();

  const scoreRetriever = createCloudShareGuidedJourneyProvider(cloudshare);

  const audit = createInMemoryAuditRepository();
  const resources = createInMemoryResourceRepository();
  const eventLog = createInMemoryEventLogRepository();
  const resourceLister = createCloudShareResourceLister(cloudshare);

  // Capture every published integration event into the event log so the admin
  // /events endpoint gives a full history without additional instrumentation.
  // Subscribe to each known type — the bus does not support wildcard listeners.
  events.subscribe("exam_attempt.created", async (event) => {
    await eventLog.append({
      eventId: event.id,
      type: event.type,
      occurredAt: event.occurredAt,
      payload: event as unknown as Record<string, unknown>,
    });
  });

  // Demo step progress tracker — cleared by resetDemo().
  const completedDemoSteps = new Set<DemoStep>();

  function markStepDone(step: DemoStep): void {
    completedDemoSteps.add(step);
  }

  function resetDemo(): void {
    examAttempts.reset();
    labLaunches.reset();
    environments.reset();
    audit.reset();
    eventLog.reset();
    webhookIdempotency.reset();
    environmentSimulator?.reset();
    kryterion.reset();
    completedDemoSteps.clear();
  }

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
    labProvisioner,
    labLaunches,
    environments,
    environmentSource,
    environmentController,
    environmentSimulator,
    webhookIdempotency,
    heartbeatAutoSuspend,
    scoreRetriever,
    audit,
    resources,
    eventLog,
    resourceLister,
    completedDemoSteps,
    markStepDone,
    resetDemo,
  };
  globalForServices.__portalServices = services;
  return services;
}
