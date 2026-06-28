import { PrismaClient } from "@prisma/client";
import { loadConfig, secretValues, type Config } from "@/config";
import { createLogger, type Logger } from "@/observability/logger";
import {
  createHeartbeatRepository,
  type HeartbeatRepository,
} from "@/persistence/heartbeat-repository";
import {
  createPortalAuthenticator,
  hashPassword,
  type PortalAuthenticator,
} from "@/auth";
import {
  createKryterionSimulator,
  type KryterionSimulator,
} from "@/legacy-simulator/kryterion/simulator";
import { createGenesysSimulator } from "@/legacy-simulator/genesys/simulator";
import { genesysDemoData } from "@/legacy-simulator/genesys/demo-data";
import { createInMemoryEventBus, type IntegrationEventBus } from "@/domain/event-bus";
import { createCloudShareIntegration } from "@/integrations/cloudshare";
import { createCloudShareIntegrationForConnection } from "@/integrations/cloudshare";
import { createCloudShareLabProvisioner } from "@/integrations/cloudshare/labs";
import { createCloudShareEnvironmentSource } from "@/integrations/cloudshare/environment";
import {
  createCloudShareEnvironmentSimulator,
  type CloudShareEnvironmentSimulator,
} from "@/integrations/cloudshare/environment-simulator";
import { createCloudShareEnvironmentController } from "@/integrations/cloudshare/environment-controller";
import { createInMemoryWebhookIdempotencyStore } from "@/persistence/webhook-idempotency-store";
import {
  createHeartbeatAutoSuspend,
  type HeartbeatAutoSuspend,
} from "@/domain/heartbeat-auto-suspend";
import { runHeartbeatAutoSuspend } from "@/api/suspend-resume";
import { createExamClock, type ExamClock } from "@/domain/exam-clock";
import { type DemoStep } from "@/domain/demo-control";
import { createCloudShareGuidedJourneyProvider } from "@/integrations/cloudshare/guided-journey";
import { createInMemoryAuditRepository } from "@/persistence/audit-repository";
import { createInMemoryResourceRepository } from "@/persistence/resource-repository";
import { createInMemoryEventLogRepository } from "@/persistence/event-log-repository";
import { createPrismaDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import {
  createDiagnosticRecorder,
  type DiagnosticLogRepository,
  type DiagnosticRecorder,
} from "@/domain/diagnostic-log";
import { createInMemoryExamAuthoringCacheRepository } from "@/persistence/exam-authoring-cache-repository";
import { createPrismaExamCatalogRepository } from "@/persistence/prisma-exam-catalog-repository";
import { createPrismaExamAttemptRepository } from "@/persistence/prisma-exam-attempt-repository";
import { createPrismaLabLaunchRepository } from "@/persistence/prisma-lab-launch-repository";
import { createPrismaAdminMonitoringAttemptRepository } from "@/persistence/prisma-admin-monitoring-attempt-repository";
import { createPrismaEnvironmentRepository } from "@/persistence/prisma-environment-repository";
import { createPrismaExamClockRepository } from "@/persistence/prisma-exam-clock-repository";
import {
  createPortalSessionStore,
  createPortalUserRepository,
  type PortalUserRepository,
} from "@/persistence/portal-auth-repository";
import { createCloudShareConnectionRepository } from "@/persistence/cloudshare-connection-repository";
import type { ScoreRetrievalProvider } from "@/domain/score-result";
import type { ExamEligibilityProvider } from "@/legacy-simulator/eligibility";
import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import type { LabProvisioner, LabLaunchRepository } from "@/domain/lab-launch";
import type { EnvironmentController, EnvironmentRepository, EnvironmentStateSource } from "@/domain/environment";
import type { WebhookIdempotencyStore } from "@/domain/webhook";
import type { AuditRepository } from "@/domain/audit-trail";
import type { ResourceRepository } from "@/domain/resource-sync";
import type { EventLogRepository } from "@/domain/event-log";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { AdminMonitoringAttemptRepository } from "@/domain/admin-monitoring";
import type { AdminExamAttemptDiagnosticContextRepository } from "@/domain/admin-exam-attempt-diagnostics";
import type { ExamRepository } from "@/domain/exam-catalog";
import type { ExamAuthoringCacheRepository } from "@/persistence/exam-authoring-cache-repository";
import { createSecretBox } from "@/security/secret-box";
import { createPrismaAdminExamAttemptDiagnosticContextRepository } from "@/persistence/prisma-admin-exam-attempt-diagnostic-context-repository";

/**
 * Composition root. The framework-agnostic modules are pure and dependency-free;
 * this is the one place that loads real config (failing fast at boot), constructs
 * the Prisma client and logger, and exposes them to the Next.js route handlers.
 *
 * A single set of instances is reused across requests to avoid exhausting the
 * SQLite connection pool during development hot-reloads.
 */

export interface LegacySimulatorDemoServices {
  readonly kryterion: KryterionSimulator;
  readonly genesys: ExamEligibilityProvider;
}

export interface LegacyDemoRuntimeControls {
  /**
   * Which demo steps have been explicitly completed in this server instance's
   * lifetime. Cleared by `resetDemo()` for repeat runs.
   */
  readonly completedDemoSteps: ReadonlySet<DemoStep>;
  /** Record one completed demo step — the only external mutation path for completedDemoSteps. */
  readonly markStepDone: (step: DemoStep) => void;
  /** Reset all demo in-memory state for a clean repeat run. */
  readonly resetDemo: () => Promise<void>;
}

export interface Services {
  config: Config;
  logger: Logger;
  prisma: PrismaClient;
  heartbeats: HeartbeatRepository;
  portalAuth: PortalAuthenticator;
  portalUsers: PortalUserRepository;
  /** Retired simulator dependencies retained only for the quarantined `/demo` compatibility surface. */
  legacySimulatorDemo: LegacySimulatorDemoServices;
  /** Deterministic `/demo` progress/reset controls retained only for the legacy demo surface. */
  legacyDemoRuntimeControls: LegacyDemoRuntimeControls;
  examClock: ExamClock;
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
  /** Typed, append-only diagnostic log — the Support read model (ADR-004). */
  diagnostics: DiagnosticLogRepository;
  /** Redaction-applying write seam every instrumented flow records through. */
  diagnosticRecorder: DiagnosticRecorder;
  adminMonitoringAttempts: AdminMonitoringAttemptRepository;
  adminExamAttemptDiagnosticContexts: AdminExamAttemptDiagnosticContextRepository;
  exams: ExamRepository;
  examAuthoringCache: ExamAuthoringCacheRepository;
  cloudshareConnections: CloudShareConnectionRepository;
  cloudshareClientFactory: CloudShareClientFactory;
  ensurePortalSeeded(): Promise<void>;
}

const globalForServices = globalThis as unknown as {
  __portalServices?: Services;
};

export function getServices(): Services {
  if (globalForServices.__portalServices) {
    if (isReusableServices(globalForServices.__portalServices)) {
      return globalForServices.__portalServices;
    }

    // Next dev hot-reload can preserve the global singleton while module shapes
    // change. If a required service method is missing, discard the stale instance
    // instead of mixing new route code with old dependency objects.
    void globalForServices.__portalServices.prisma.$disconnect();
    globalForServices.__portalServices.heartbeatAutoSuspend.stop();
    globalForServices.__portalServices = undefined;
  }

  const config = loadConfig(process.env);
  const prisma = new PrismaClient();
  const diagnostics = createPrismaDiagnosticLogRepository(prisma);
  const logger = createLogger({
    secrets: secretValues(config),
    sink: (line: string) => {
      process.stdout.write(line + "\n");
    },
  });
  const diagnosticRecorder = createDiagnosticRecorder({
    repository: diagnostics,
    // Global/seed secret values for string scrubbing. NOTE: these do NOT include
    // per-Customer decrypted CloudShare credentials. Key-based redaction still
    // scrubs sensitive *fields* regardless, but a future slice that records
    // CloudShare request/response payloads must pass that connection's secrets
    // (apiId/apiKey/webhookSecret) into a per-call recorder so a secret embedded
    // mid-string under a non-sensitive key cannot leak. The auth/account flows
    // instrumented in this slice never touch CloudShare credentials.
    secrets: secretValues(config),
    // Sensitive mode stays disabled: secrets are always redacted in normal mode.
    sensitiveMode: false,
    onError: (error) =>
      logger.error("diagnostic log append failed", {
        error: error instanceof Error ? error.message : String(error),
      }),
  });
  const traceCloudShare = (event: {
    readonly level: "info" | "warn";
    readonly message: string;
    readonly fields: Record<string, unknown>;
  }): void => {
    if (event.level === "warn") {
      logger.warn(event.message, event.fields);
      return;
    }
    logger.info(event.message, event.fields);
  };
  const heartbeats = createHeartbeatRepository(prisma);

  const portalUsers = createPortalUserRepository(prisma);
  const portalSessions = createPortalSessionStore(prisma);
  const portalAuth = createPortalAuthenticator({
    users: portalUsers,
    sessions: portalSessions,
  });
  const kryterion = createKryterionSimulator({
    secret: config.secrets.kryterionTokenSecret,
    ttlSeconds: 120,
  });

  // Legacy demo eligibility and active event bus. The bus carries
  // exam_attempt.created events; a failing subscriber is logged, not allowed to
  // break publishing.
  const genesys = createGenesysSimulator(genesysDemoData);
  // Each in-memory repo exposes reset() for the demo clean-slate operation.
  const examAttempts = createPrismaExamAttemptRepository(prisma);
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
    trace: traceCloudShare,
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
  const labLaunches = createPrismaLabLaunchRepository(prisma);

  // Webhook receiver & polling source-of-truth. In demo mode the simulator is BOTH
  // the webhook emitter, the authoritative poll target, AND the suspend/resume
  // command target — its emitted events, poll answers, and control commands all
  // share one in-memory truth. In live mode the poll and commands hit CloudShare.
  const environmentSimulator =
    config.runtime.mode === "fixture"
      ? createCloudShareEnvironmentSimulator({
          secret:
            config.seed.heliosCloudShareConnection?.webhookSecret ??
            config.secrets.webhookSecret,
        })
      : null;
  const environmentSource: EnvironmentStateSource =
    environmentSimulator ?? createCloudShareEnvironmentSource(cloudshare);
  const environmentController: EnvironmentController =
    environmentSimulator ?? createCloudShareEnvironmentController(cloudshare);
  const environments = createPrismaEnvironmentRepository(prisma);
  const webhookIdempotency = createInMemoryWebhookIdempotencyStore();
  const examClock = createExamClock({
    clocks: createPrismaExamClockRepository(prisma),
  });
  const eventLog = createInMemoryEventLogRepository();

  const scoreRetriever = createCloudShareGuidedJourneyProvider(cloudshare);

  const audit = createInMemoryAuditRepository();
  const resources = createInMemoryResourceRepository();
  const exams = createPrismaExamCatalogRepository(prisma);
  const adminMonitoringAttempts = createPrismaAdminMonitoringAttemptRepository(prisma);
  const adminExamAttemptDiagnosticContexts =
    createPrismaAdminExamAttemptDiagnosticContextRepository(prisma);
  const examAuthoringCache = createInMemoryExamAuthoringCacheRepository();
  const cloudshareSecretBox = createSecretBox(
    Buffer.from(config.secrets.portalMasterKey, "base64"),
  );
  const cloudshareConnections = createCloudShareConnectionRepository(
    prisma,
    cloudshareSecretBox,
  );
  const cloudshareClientFactory: CloudShareClientFactory = {
    forConnection: (connection) =>
      createCloudShareIntegrationForConnection({
        mode: config.runtime.mode,
        trace: traceCloudShare,
        connection: {
          customerId: connection.customerId,
          apiId: connection.apiId,
          apiKey: connection.apiKey,
          webhookSecret: connection.webhookSecret,
        },
      }),
  };

  // Heartbeat auto-suspend. The suspend function is pre-bound to the current
  // service instances so HeartbeatAutoSuspend stays free of framework concerns.
  const heartbeatAutoSuspend = createHeartbeatAutoSuspend({
    timeoutMs: config.runtime.heartbeatTimeoutMs,
    logger,
    suspendFn: (examAttemptId) =>
      runHeartbeatAutoSuspend(
        {
          controller: environmentController,
          source: environmentSource,
          timer: examClock,
          attempts: examAttempts,
          launches: labLaunches,
          logger,
          eventLog,
          connections: cloudshareConnections,
          cloudshare: cloudshareClientFactory,
          diagnostics: diagnosticRecorder,
          now: () => new Date(),
          sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        },
        examAttemptId,
      ),
  });
  heartbeatAutoSuspend.start();

  let portalSeedPromise: Promise<void> | null = null;

  async function ensurePortalSeeded(): Promise<void> {
    const heliosAdmin = config.seed.heliosAdmin;
    if (!heliosAdmin) {
      return;
    }

    if (!portalSeedPromise) {
      portalSeedPromise = (async () => {
        const user = await portalUsers.upsertSeedUser({
          customerSlug: "helios-cx",
          customerName: "Helios CX",
          email: heliosAdmin.email,
          passwordHash: await hashPassword(heliosAdmin.password),
          role: "admin",
        });

        if (config.seed.heliosCloudShareConnection) {
          await cloudshareConnections.save({
            customerId: user.customerId,
            apiId: config.seed.heliosCloudShareConnection.apiId,
            apiKey: config.seed.heliosCloudShareConnection.apiKey,
            webhookSecret: config.seed.heliosCloudShareConnection.webhookSecret,
          });
        }
      })().catch((error) => {
        portalSeedPromise = null;
        throw error;
      });
    }

    await portalSeedPromise;
  }

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

  async function resetDemo(): Promise<void> {
    await prisma.examClock.deleteMany();
    await prisma.labLaunch.deleteMany();
    await prisma.examAttempt.deleteMany();
    await prisma.environmentRecord.deleteMany();
    audit.reset();
    eventLog.reset();
    await diagnostics.reset();
    examAuthoringCache.reset();
    webhookIdempotency.reset();
    environmentSimulator?.reset();
    kryterion.reset();
    heartbeatAutoSuspend.reset();
    completedDemoSteps.clear();
  }

  const services: Services = {
    config,
    logger,
    prisma,
    heartbeats,
    portalAuth,
    portalUsers,
    legacySimulatorDemo: {
      kryterion,
      genesys,
    },
    legacyDemoRuntimeControls: {
      completedDemoSteps,
      markStepDone,
      resetDemo,
    },
    examClock,
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
    diagnostics,
    diagnosticRecorder,
    adminMonitoringAttempts,
    adminExamAttemptDiagnosticContexts,
    exams,
    examAuthoringCache,
    cloudshareConnections,
    cloudshareClientFactory,
    ensurePortalSeeded,
  };
  globalForServices.__portalServices = services;
  return services;
}

function isReusableServices(services: Services): boolean {
  return (
    typeof services.cloudshareConnections?.findByWebhookPathToken === "function" &&
    typeof services.cloudshareClientFactory?.forConnection === "function" &&
    typeof services.legacySimulatorDemo?.kryterion?.getTimerState === "function" &&
    typeof services.legacySimulatorDemo?.genesys?.listEligibleExams === "function" &&
    typeof services.legacyDemoRuntimeControls?.completedDemoSteps?.has === "function" &&
    typeof services.legacyDemoRuntimeControls?.markStepDone === "function" &&
    typeof services.legacyDemoRuntimeControls?.resetDemo === "function"
  );
}
