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
import { createInMemoryEventBus, type IntegrationEventBus } from "@/domain/event-bus";
import { createCloudShareIntegration } from "@/integrations/cloudshare";
import { createCloudShareIntegrationForConnection } from "@/integrations/cloudshare";
import { createCloudShareTrainingDelivery } from "@/integrations/cloudshare/training-delivery";
import { createCloudShareEnvironmentSource } from "@/integrations/cloudshare/environment";
import {
  createCloudShareEnvironmentSimulator,
  type CloudShareEnvironmentSimulator,
} from "@/integrations/cloudshare/environment-simulator";
import { createCloudShareEnvironmentController } from "@/integrations/cloudshare/environment-controller";
import { withLocalCohortRateLimitQaFixture } from "@/integrations/cloudshare/local-rate-limit-qa-fixture";
import { createInMemoryWebhookIdempotencyStore } from "@/persistence/webhook-idempotency-store";
import {
  createHeartbeatAutoSuspend,
  type HeartbeatAutoSuspend,
} from "@/domain/heartbeat-auto-suspend";
import { runHeartbeatAutoSuspend } from "@/api/suspend-resume";
import { createExamClock, type ExamClock } from "@/domain/exam-clock";
import { createPrismaAuditRepository } from "@/persistence/audit-repository";
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
import { createPrismaCohortExamSessionRepository } from "@/persistence/prisma-cohort-exam-session-repository";
import { createPrismaCohortMonitoringObservationRepository } from "@/persistence/prisma-cohort-monitoring-observation-repository";
import { createPrismaExamAttemptRepository } from "@/persistence/prisma-exam-attempt-repository";
import { createPrismaLabLaunchRepository } from "@/persistence/prisma-lab-launch-repository";
import { createPrismaAdminMonitoringAttemptRepository } from "@/persistence/prisma-admin-monitoring-attempt-repository";
import { createPrismaAdminCandidateRepository } from "@/persistence/prisma-admin-candidate-repository";
import { createPrismaEnvironmentRepository } from "@/persistence/prisma-environment-repository";
import { createPrismaExamClockRepository } from "@/persistence/prisma-exam-clock-repository";
import {
  createPortalSessionStore,
  createPortalUserRepository,
  type PortalUserRepository,
} from "@/persistence/portal-auth-repository";
import { createCloudShareConnectionRepository } from "@/persistence/cloudshare-connection-repository";
import type { ScoreRetrievalProvider } from "@/domain/score-result";
import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import type { LabLaunchRepository } from "@/domain/lab-launch";
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
import type { AdminCandidateRepository } from "@/domain/admin-candidates";
import type { AdminExamAttemptDiagnosticContextRepository } from "@/domain/admin-exam-attempt-diagnostics";
import type { ExamRepository } from "@/domain/exam-catalog";
import type { CohortExamSessionRepository } from "@/domain/cohort-exam-session";
import type { CohortMonitoringObservationRepository } from "@/domain/cohort-monitoring-observation";
import type { ExamAuthoringCacheRepository } from "@/persistence/exam-authoring-cache-repository";
import { createSecretBox } from "@/security/secret-box";
import { createPrismaAdminExamAttemptDiagnosticContextRepository } from "@/persistence/prisma-admin-exam-attempt-diagnostic-context-repository";
import type { AdminCandidateServices } from "@/api/admin-candidates";
import type { AdminCohortExamSessionServices } from "@/api/admin-cohort-exam-sessions";
import type { AdminExamAuthoringServices } from "@/api/admin-exams";
import type { CandidateRegistrationServices } from "@/api/candidate-portal";
import type { CandidateSuspendResumeServices } from "@/api/candidate-suspend-resume-route";
import type {
  PortalLoginServices,
  PortalLogoutServices,
  PortalSessionServices,
} from "@/api/portal-auth";
import type { PortalSessionDeps } from "@/auth/portal-session";

/**
 * Composition root. The framework-agnostic modules are pure and dependency-free;
 * this is the one place that loads real config (failing fast at boot), constructs
 * the Prisma client and logger, and exposes them to the Next.js route handlers.
 *
 * A single set of instances is reused across requests to avoid exhausting the
 * SQLite connection pool during development hot-reloads.
 */

export type FeatureModuleInputs =
  & PortalSessionDeps
  & PortalLoginServices
  & PortalLogoutServices
  & CandidateRegistrationServices
  & AdminCandidateServices
  & AdminExamAuthoringServices
  & AdminCohortExamSessionServices
  & CandidateSuspendResumeServices;

export interface FeatureModules {
  readonly portal: {
    readonly session: PortalSessionDeps & PortalSessionServices;
    readonly login: PortalLoginServices;
    readonly logout: PortalLogoutServices;
  };
  readonly registration: CandidateRegistrationServices;
  readonly adminCandidates: AdminCandidateServices;
  readonly adminExamAuthoring: AdminExamAuthoringServices;
  readonly adminCohortExamSessions: AdminCohortExamSessionServices;
  readonly candidateSuspendResume: CandidateSuspendResumeServices;
}

export function createFeatureModules(services: FeatureModuleInputs): FeatureModules {
  return {
    portal: {
      session: {
        portalAuth: services.portalAuth,
        ensurePortalSeeded: services.ensurePortalSeeded,
      },
      login: {
        portalAuth: services.portalAuth,
        diagnosticRecorder: services.diagnosticRecorder,
        portalUsers: services.portalUsers,
        audit: services.audit,
      },
      logout: {
        portalAuth: services.portalAuth,
        diagnosticRecorder: services.diagnosticRecorder,
        environmentController: services.environmentController,
        environmentSource: services.environmentSource,
        examClock: services.examClock,
        exams: services.exams,
        examAttempts: services.examAttempts,
        labLaunches: services.labLaunches,
        logger: services.logger,
        eventLog: services.eventLog,
        cloudshareConnections: services.cloudshareConnections,
        cloudshareClientFactory: services.cloudshareClientFactory,
        heartbeatAutoSuspend: services.heartbeatAutoSuspend,
        audit: services.audit,
      },
    },
    registration: {
      portalUsers: services.portalUsers,
      logger: services.logger,
      diagnosticRecorder: services.diagnosticRecorder,
    },
    adminCandidates: {
      adminCandidates: services.adminCandidates,
      diagnostics: services.diagnostics,
      logger: services.logger,
    },
    adminExamAuthoring: {
      cloudshareConnections: services.cloudshareConnections,
      cloudshareClientFactory: services.cloudshareClientFactory,
      examAuthoringCache: services.examAuthoringCache,
      diagnosticRecorder: services.diagnosticRecorder,
      logger: services.logger,
    },
    adminCohortExamSessions: {
      exams: services.exams,
      cohortExamSessions: services.cohortExamSessions,
      diagnosticRecorder: services.diagnosticRecorder,
      audit: services.audit,
      cloudshareConnections: services.cloudshareConnections,
      cloudshareClientFactory: services.cloudshareClientFactory,
      logger: services.logger,
    },
    candidateSuspendResume: {
      environmentSource: services.environmentSource,
      environmentController: services.environmentController,
      examAttempts: services.examAttempts,
      labLaunches: services.labLaunches,
      examClock: services.examClock,
      exams: services.exams,
      logger: services.logger,
      heartbeatAutoSuspend: services.heartbeatAutoSuspend,
      audit: services.audit,
      eventLog: services.eventLog,
      cloudshareConnections: services.cloudshareConnections,
      cloudshareClientFactory: services.cloudshareClientFactory,
      diagnosticRecorder: services.diagnosticRecorder,
    },
  };
}

export function isReusableFeatureModules(value: unknown): value is FeatureModules {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const modules = value as Partial<FeatureModules>;
  return (
    hasModuleProperties(modules.portal?.session, ["portalAuth", "ensurePortalSeeded"]) &&
    hasModuleProperties(modules.portal?.login, ["portalAuth", "portalUsers", "diagnosticRecorder", "audit"]) &&
    hasModuleProperties(modules.portal?.logout, [
      "portalAuth",
      "diagnosticRecorder",
      "environmentController",
      "environmentSource",
      "examClock",
      "exams",
      "examAttempts",
      "labLaunches",
      "logger",
      "eventLog",
      "cloudshareConnections",
      "cloudshareClientFactory",
      "heartbeatAutoSuspend",
      "audit",
    ]) &&
    hasModuleProperties(modules.registration, ["portalUsers", "logger", "diagnosticRecorder"]) &&
    hasModuleProperties(modules.adminCandidates, ["adminCandidates", "diagnostics", "logger"]) &&
    hasModuleProperties(modules.adminExamAuthoring, [
      "cloudshareConnections",
      "cloudshareClientFactory",
      "examAuthoringCache",
      "diagnosticRecorder",
      "logger",
    ]) &&
    hasModuleProperties(modules.adminCohortExamSessions, [
      "exams",
      "cohortExamSessions",
      "diagnosticRecorder",
      "audit",
      "cloudshareConnections",
      "cloudshareClientFactory",
      "logger",
    ]) &&
    hasModuleProperties(modules.candidateSuspendResume, [
      "environmentSource",
      "environmentController",
      "examAttempts",
      "labLaunches",
      "examClock",
      "exams",
      "logger",
      "heartbeatAutoSuspend",
      "audit",
      "eventLog",
      "cloudshareConnections",
      "cloudshareClientFactory",
      "diagnosticRecorder",
    ])
  );
}

function hasModuleProperties(value: unknown, properties: readonly string[]): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    properties.every((property) => property in value)
  );
}

export interface Services {
  config: Config;
  logger: Logger;
  prisma: PrismaClient;
  heartbeats: HeartbeatRepository;
  portalAuth: PortalAuthenticator;
  portalUsers: PortalUserRepository;
  examClock: ExamClock;
  examAttempts: ExamAttemptRepository;
  events: IntegrationEventBus;
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
  adminCandidates: AdminCandidateRepository;
  adminExamAttemptDiagnosticContexts: AdminExamAttemptDiagnosticContextRepository;
  exams: ExamRepository;
  cohortExamSessions: CohortExamSessionRepository;
  cohortMonitoringObservations: CohortMonitoringObservationRepository;
  examAuthoringCache: ExamAuthoringCacheRepository;
  cloudshareConnections: CloudShareConnectionRepository;
  cloudshareClientFactory: CloudShareClientFactory;
  ensurePortalSeeded(): Promise<void>;
  featureModules: FeatureModules;
  dispose(): void;
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
    disposeStaleServices(globalForServices.__portalServices);
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
  const trainingDelivery = createCloudShareTrainingDelivery(cloudshare);
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

  const scoreRetriever = trainingDelivery;

  const audit = createPrismaAuditRepository(prisma);
  const resources = createInMemoryResourceRepository();
  const exams = createPrismaExamCatalogRepository(prisma);
  const cohortExamSessions = createPrismaCohortExamSessionRepository(prisma);
  const cohortMonitoringObservations = createPrismaCohortMonitoringObservationRepository(prisma);
  const adminMonitoringAttempts = createPrismaAdminMonitoringAttemptRepository(prisma);
  const adminCandidates = createPrismaAdminCandidateRepository(prisma);
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
      withLocalCohortRateLimitQaFixture(createCloudShareIntegrationForConnection({
        mode: config.runtime.mode,
        trace: traceCloudShare,
        connection: {
          customerId: connection.customerId,
          apiId: connection.apiId,
          apiKey: connection.apiKey,
          webhookSecret: connection.webhookSecret,
        },
      })),
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
    const certalisSalesAdmin = config.seed.certalisSalesAdmin;
    if (!heliosAdmin && !certalisSalesAdmin) {
      return;
    }

    if (!portalSeedPromise) {
      portalSeedPromise = (async () => {
        const user = heliosAdmin
          ? await portalUsers.upsertSeedUser({
              customerSlug: "helios-cx",
              customerName: "Helios CX",
              email: heliosAdmin.email,
              passwordHash: await hashPassword(heliosAdmin.password),
              role: "admin",
              workspace: "certification",
            })
          : null;

        if (certalisSalesAdmin) {
          await portalUsers.upsertSeedUser({
            customerSlug: "certalis",
            customerName: "Certalis",
            email: certalisSalesAdmin.email,
            passwordHash: await hashPassword(certalisSalesAdmin.password),
            role: "admin",
            workspace: "sales",
          });
        }

        if (user && config.seed.heliosCloudShareConnection) {
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

  const serviceInputs: Omit<Services, "featureModules" | "dispose"> = {
    config,
    logger,
    prisma,
    heartbeats,
    portalAuth,
    portalUsers,
    examClock,
    examAttempts,
    events,
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
    adminCandidates,
    adminExamAttemptDiagnosticContexts,
    exams,
    cohortExamSessions,
    cohortMonitoringObservations,
    examAuthoringCache,
    cloudshareConnections,
    cloudshareClientFactory,
    ensurePortalSeeded,
  };
  const services: Services = {
    ...serviceInputs,
    featureModules: createFeatureModules(serviceInputs),
    dispose: () => {
      void prisma.$disconnect();
      heartbeatAutoSuspend.stop();
    },
  };
  globalForServices.__portalServices = services;
  return services;
}

export function getPortalSessionServices(): PortalSessionDeps & PortalSessionServices {
  return getServices().featureModules.portal.session;
}

export function getPortalLoginServices(): PortalLoginServices {
  return getServices().featureModules.portal.login;
}

export function getPortalLogoutServices(): PortalLogoutServices {
  return getServices().featureModules.portal.logout;
}

export function getCandidateRegistrationServices(): CandidateRegistrationServices {
  return getServices().featureModules.registration;
}

export function getAdminCandidateServices(): AdminCandidateServices {
  return getServices().featureModules.adminCandidates;
}

export function getAdminExamAuthoringServices(): AdminExamAuthoringServices {
  return getServices().featureModules.adminExamAuthoring;
}

export function getAdminCohortExamSessionServices(): AdminCohortExamSessionServices {
  return getServices().featureModules.adminCohortExamSessions;
}

export function getCandidateSuspendResumeServices(): CandidateSuspendResumeServices {
  return getServices().featureModules.candidateSuspendResume;
}

function isReusableServices(services: Services): boolean {
  return typeof services.dispose === "function" && isReusableFeatureModules(services.featureModules);
}

export function disposeStaleServices(services: unknown): void {
  if (typeof services !== "object" || services === null) {
    return;
  }

  const stale = services as {
    dispose?: unknown;
    prisma?: { $disconnect?: unknown };
    heartbeatAutoSuspend?: { stop?: unknown };
  };

  if (typeof stale.dispose === "function") {
    stale.dispose();
    return;
  }

  if (typeof stale.prisma?.$disconnect === "function") {
    void stale.prisma.$disconnect();
  }
  if (typeof stale.heartbeatAutoSuspend?.stop === "function") {
    stale.heartbeatAutoSuspend.stop();
  }
}
