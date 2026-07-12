import { describe, expect, it, vi } from "vitest";
import {
  createFeatureModules,
  disposeStaleServices,
  isReusableFeatureModules,
  type FeatureModuleInputs,
} from "./composition";

function createInputs(): FeatureModuleInputs {
  return {
    portalAuth: { resume: vi.fn() },
    portalUsers: { findByEmail: vi.fn() },
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
  it("exposes the approved narrow dependency bundles", () => {
    const inputs = createInputs();

    const modules = createFeatureModules(inputs);

    expect(modules.portal.session).toEqual({
      portalAuth: inputs.portalAuth,
      ensurePortalSeeded: inputs.ensurePortalSeeded,
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
