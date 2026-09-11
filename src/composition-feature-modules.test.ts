import { describe, expect, it, vi } from "vitest";
import {
  createCloudShareClientFactory,
  createFeatureModules,
  disposeStaleServices,
  isReusableServices,
  isReusableFeatureModules,
  type FeatureModuleInputs,
} from "./composition";
import type { CloudShareClient, CloudShareRequestObservation, V4TokenAcquisitionEvent } from "@/integrations/cloudshare";
import { createCloudShareIntegrationForConnection } from "@/integrations/cloudshare";
import type { CloudShareConnectionRecord } from "@/domain/cloudshare-connection";
import { createCloudShareWorkflowSequenceAllocator } from "@/ports/cloudshare-observation";
import { createDiagnosticRecorder } from "@/domain/diagnostic-log";

const CONNECTION: CloudShareConnectionRecord = {
  customerId: "customer-a", apiId: "api-id", apiKey: "api-key", webhookSecret: "webhook-secret",
  webhookPathToken: "path-token", connectedAt: new Date("2026-09-03T00:00:00.000Z"), verifiedAt: null,
};

function createObservedFactory() {
  const record = vi.fn();
  const integrations: Parameters<typeof createCloudShareIntegrationForConnection>[0][] = [];
  let correlationSequence = 0;
  const factory = createCloudShareClientFactory({
    diagnostics: { record } as never,
    mode: "fixture",
    newCorrelationId: () => `mandatory-customer-correlation-${++correlationSequence}`,
    createIntegration: (input) => {
      integrations.push(input);
      return {} as CloudShareClient;
    },
    decorateClient: (client) => client,
  });
  return { factory, record, integrations };
}

const OAUTH_EVENT: V4TokenAcquisitionEvent = {
  occurredAt: "2026-09-03T12:00:00.000Z", outcome: "success" as const, durationMs: 1,
  integrationSurface: "cloudshare.v4.oauth.token",
};

const REQUEST_EVENT: CloudShareRequestObservation = {
  occurredAt: "2026-09-03T12:00:01.000Z", outcome: "success" as const, durationMs: 1,
  result: { data: null, request: { method: "GET", path: "/trainings" }, response: { status: 200, body: null }, integrationSurface: "cloudshare.v4.training", host: "example.test" },
};

function createInputs(): FeatureModuleInputs {
  return {
    portalAuth: { resume: vi.fn() },
    portalUsers: { findByEmail: vi.fn() },
    portalSessions: { save: vi.fn(), findById: vi.fn(), deleteById: vi.fn() },
    ensurePortalSeeded: vi.fn(),
    diagnosticRecorder: { record: vi.fn() },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    environmentSource: { getEnvironment: vi.fn() },
    environmentController: { suspendEnvironment: vi.fn(), resumeEnvironment: vi.fn() },
    examAttempts: { findById: vi.fn() },
    labLaunches: { findByExamAttemptId: vi.fn() },
    examClock: { start: vi.fn(), pause: vi.fn(), resume: vi.fn() },
    exams: { findById: vi.fn() },
    heartbeatAutoSuspend: { removeHeartbeat: vi.fn() },
    audit: { write: vi.fn() },
    eventLog: { append: vi.fn() },
    cloudshareConnections: { findByCustomerId: vi.fn() },
    cloudshareClientFactory: { forConnection: vi.fn() },
    adminCandidates: { listByCustomerId: vi.fn() },
    diagnostics: { list: vi.fn() },
    examAuthoringCache: { get: vi.fn() },
    cohortExamSessions: { listByExamId: vi.fn() },
  } as unknown as FeatureModuleInputs;
}

describe("composition feature modules", () => {
  it("composes mandatory Customer evidence with a workflow observer and fails open when its callback fails", async () => {
    const { factory, record, integrations } = createObservedFactory();
    const customRequest = vi.fn().mockRejectedValue(new Error("custom observation unavailable"));

    const allocator = createCloudShareWorkflowSequenceAllocator();
    factory.forConnection(CONNECTION, {
      scope: "workflow",
      workflow: {
        actor: { type: "candidate", id: "candidate-1" }, subject: { type: "exam_attempt", id: "attempt-1" },
        correlationId: "workflow-correlation", source: "runtime", sequenceAllocator: allocator,
      },
      onRequest: customRequest,
    });
    expect(integrations[0].attemptStartAllocator).toBe(allocator);
    await integrations[0].observer.onAcquisition(OAUTH_EVENT);
    await integrations[0].observer.onRequest(REQUEST_EVENT);

    expect(customRequest).toHaveBeenCalledOnce();
    expect(record.mock.calls.map(([entry]) => entry)).toEqual([
      expect.objectContaining({ customerId: "customer-a", subject: { type: "exam_attempt", id: "attempt-1" }, correlationId: "workflow-correlation", operation: "cloudshare.oauth.token" }),
      expect.objectContaining({ customerId: "customer-a", subject: { type: "exam_attempt", id: "attempt-1" }, correlationId: "workflow-correlation", operation: "cloudshare.request" }),
    ]);
  });

  it("requires one explicit scope and composes Customer-only and custom-observer scopes fail-open", async () => {
    const { factory, record, integrations } = createObservedFactory();
    expect(() => factory.forConnection(CONNECTION, undefined)).toThrow("explicit observation scope");

    factory.forConnection(CONNECTION, { scope: "customer_default", reason: "catalogue_resource_read" });
    await integrations[0].observer.onRequest(REQUEST_EVENT);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      customerId: "customer-a", subject: { type: "customer", id: "customer-a" }, correlationId: "mandatory-customer-correlation-1",
    }));

    const customAcquisition = vi.fn().mockRejectedValue(new Error("custom observer unavailable"));
    factory.forConnection(CONNECTION, { scope: "custom_observer", correlationId: "custom-correlation", actor: { type: "admin", id: "admin-1" }, subject: { type: "sales_trial_enrollment", id: "enrollment-1" }, onAcquisition: customAcquisition });
    await integrations[1].observer.onAcquisition(OAUTH_EVENT);
    expect(customAcquisition).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ correlationId: "custom-correlation", actor: { type: "admin", id: "admin-1" }, subject: { type: "sales_trial_enrollment", id: "enrollment-1" } }));
  });

  it("keeps mandatory Customer evidence isolated across connections", async () => {
    const { factory, record, integrations } = createObservedFactory();
    factory.forConnection(CONNECTION, { scope: "customer_default", reason: "connection_check" });
    factory.forConnection({ ...CONNECTION, customerId: "customer-b" }, { scope: "customer_default", reason: "connection_check" });
    await integrations[0].observer.onAcquisition(OAUTH_EVENT);
    await integrations[1].observer.onAcquisition(OAUTH_EVENT);
    expect(record.mock.calls.map(([entry]) => entry.customerId)).toEqual(["customer-a", "customer-b"]);
    expect(record.mock.calls.map(([entry]) => entry.correlationId)).toEqual(["mandatory-customer-correlation-1", "mandatory-customer-correlation-2"]);
  });

  it("falls back to the real Customer recorder after a canonical first append rejects", async () => {
    const append = vi.fn().mockRejectedValueOnce(new Error("canonical write failed")).mockResolvedValue(undefined);
    const recorder = createDiagnosticRecorder({ repository: { append } as never });
    const integrations: Parameters<typeof createCloudShareIntegrationForConnection>[0][] = [];
    const factory = createCloudShareClientFactory({ diagnostics: recorder, mode: "fixture", createIntegration: (input) => { integrations.push(input); return {} as CloudShareClient; }, decorateClient: (client) => client });
    const custom = vi.fn((event: CloudShareRequestObservation) => recorder.recordCanonical!({ source: "sales-trial-enrollment", operation: "trial.request", outcome: event.outcome, customerId: "customer-a", correlationId: "trial-correlation", actor: { type: "admin", id: "admin-1" }, subject: { type: "sales_trial_enrollment", id: "enrollment-1" }, message: "trial exchange", occurredAt: new Date(event.occurredAt) }));
    factory.forConnection(CONNECTION, { scope: "custom_observer", correlationId: "trial-correlation", actor: { type: "admin", id: "admin-1" }, subject: { type: "sales_trial_enrollment", id: "enrollment-1" }, source: "sales-trial-enrollment", onRequest: custom });
    await integrations[0].observer.onRequest(REQUEST_EVENT);
    expect(append).toHaveBeenCalledTimes(2);
    expect(append.mock.calls[1][0]).toMatchObject({ customerId: "customer-a", correlationId: "trial-correlation", actor: { type: "admin", id: "admin-1" }, subject: { type: "sales_trial_enrollment", id: "enrollment-1" } });
  });

  it("uses the real custom observer and recorder seam for the first canonical append failure", async () => {
    const append = vi.fn().mockRejectedValueOnce(new Error("canonical write failed")).mockResolvedValue(undefined);
    const recorder = createDiagnosticRecorder({ repository: { append } as never });
    const integrations: Parameters<typeof createCloudShareIntegrationForConnection>[0][] = [];
    const factory = createCloudShareClientFactory({ diagnostics: recorder, mode: "fixture", createIntegration: (input) => { integrations.push(input); return {} as CloudShareClient; }, decorateClient: (client) => client });
    const observer = factory.forConnection(CONNECTION, { scope: "custom_observer", source: "sales-trial-enrollment", correlationId: "corr-real-custom", actor: { type: "admin", id: "admin-real" }, subject: { type: "sales_trial_enrollment", id: "enrollment-real" }, onRequest: (event) => recorder.recordCanonical!({ source: "sales-trial-enrollment", operation: "trial.request", outcome: event.outcome, customerId: "customer-a", correlationId: "corr-real-custom", actor: { type: "admin", id: "admin-real" }, subject: { type: "sales_trial_enrollment", id: "enrollment-real" }, message: "trial exchange", occurredAt: new Date(event.occurredAt) }) });
    await integrations[0].observer.onRequest({ ...REQUEST_EVENT, exchangeId: "exchange-real" });
    expect(observer).toBeDefined();
    expect(append).toHaveBeenCalledTimes(2);
    expect(append.mock.calls[1][0]).toMatchObject({ source: "sales-trial-enrollment", correlationId: "corr-real-custom", actor: { type: "admin", id: "admin-real" }, subject: { type: "sales_trial_enrollment", id: "enrollment-real" } });
  });

  it("exposes the approved narrow dependency bundles", () => {
    const inputs = createInputs();

    const modules = createFeatureModules(inputs);

    expect(modules.portal.session).toEqual({
      portalAuth: inputs.portalAuth,
      ensurePortalSeeded: inputs.ensurePortalSeeded,
    });
    expect(modules.salesTrial.login).toEqual({
      users: inputs.portalUsers,
      sessions: inputs.portalSessions,
      diagnostics: inputs.diagnosticRecorder,
      audit: inputs.audit,
    });
    expect(modules.registration).toEqual({
      portalUsers: inputs.portalUsers,
      logger: inputs.logger,
      diagnosticRecorder: inputs.diagnosticRecorder,
    });
    expect(modules.adminCandidates).toEqual({
      adminCandidates: inputs.adminCandidates,
      diagnostics: inputs.diagnostics,
      logger: inputs.logger,
    });
    expect(modules.adminExamAuthoring).toEqual({
      cloudshareConnections: inputs.cloudshareConnections,
      cloudshareClientFactory: inputs.cloudshareClientFactory,
      examAuthoringCache: inputs.examAuthoringCache,
      diagnosticRecorder: inputs.diagnosticRecorder,
      logger: inputs.logger,
    });
    expect(modules.adminCohortExamSessions).toEqual({
      exams: inputs.exams,
      cohortExamSessions: inputs.cohortExamSessions,
      diagnosticRecorder: inputs.diagnosticRecorder,
      audit: inputs.audit,
      cloudshareConnections: inputs.cloudshareConnections,
      cloudshareClientFactory: inputs.cloudshareClientFactory,
      logger: inputs.logger,
    });
    expect(modules.candidateSuspendResume).toMatchObject({
      environmentSource: inputs.environmentSource,
      environmentController: inputs.environmentController,
      examAttempts: inputs.examAttempts,
      labLaunches: inputs.labLaunches,
      examClock: inputs.examClock,
      exams: inputs.exams,
      heartbeatAutoSuspend: inputs.heartbeatAutoSuspend,
      audit: inputs.audit,
      eventLog: inputs.eventLog,
      cloudshareConnections: inputs.cloudshareConnections,
      cloudshareClientFactory: inputs.cloudshareClientFactory,
      diagnosticRecorder: inputs.diagnosticRecorder,
      logger: inputs.logger,
    });
  });

  it("rejects a stale feature-module contract before it is reused", () => {
    const modules = createFeatureModules(createInputs());

    expect(isReusableFeatureModules(modules)).toBe(true);
    expect(
      isReusableFeatureModules({
        ...modules,
        candidateSuspendResume: {},
      }),
    ).toBe(false);
  });

  it("rejects a stale reusable service shape missing Sales Trial enrollment lookup", () => {
    const modules = createFeatureModules(createInputs());
    const dispose = vi.fn();
    const stale = { dispose, featureModules: modules, salesTrialEnrollments: {} };

    expect(isReusableServices(stale as never)).toBe(false);
    disposeStaleServices(stale);
    expect(dispose).toHaveBeenCalledOnce();
  });


  it("cleans up a legacy singleton without a dispose method", () => {
    const disconnect = vi.fn();
    const stop = vi.fn();

    disposeStaleServices({
      prisma: { $disconnect: disconnect },
      heartbeatAutoSuspend: { stop },
    });

    expect(disconnect).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });
});
