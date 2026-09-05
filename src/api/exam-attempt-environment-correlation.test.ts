import { describe, expect, it, vi } from "vitest";
import { createDiagnosticRecorder } from "@/domain/diagnostic-log";
import { CloudShareRateLimitError } from "@/integrations/cloudshare";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";
import { createInMemoryLabLaunchRepository } from "@/persistence/lab-launch-repository";
import { ensureExamAttemptEnvironmentCorrelation } from "./exam-attempt-environment-correlation";

describe("ensureExamAttemptEnvironmentCorrelation", () => {
  it("keeps OAuth 429 participant correlation evidence metadata-only", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    await attempts.save({
      id: "attempt-1",
      customerId: "customer-1",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await launches.save({
      id: "launch-1",
      examAttemptId: "attempt-1",
      candidateId: "candidate-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "EXtraining-1",
      experienceId: "EXtraining-1",
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/demo",
      status: "launched",
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    const oauthFailure = new CloudShareRateLimitError("OAuth token request throttled", 429, "rate_limit", {
      method: "POST",
      path: "/oauth/token",
      integrationSurface: "cloudshare.v4.oauth.token",
      requestBody: { client_secret: "private-secret" },
      responseBody: { access_token: "private-token" },
    });

    const result = await ensureExamAttemptEnvironmentCorrelation({
      attempts,
      launches,
      connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) } as never,
      cloudshare: { forConnection: vi.fn().mockReturnValue({ requestV4: vi.fn().mockRejectedValue(oauthFailure), requestV4Detailed: vi.fn().mockRejectedValue(oauthFailure) }) } as never,
      diagnostics: createDiagnosticRecorder({ repository: diagnosticsRepository }),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      newCorrelationId: () => "corr-oauth-environment",
    }, { examAttemptId: "attempt-1", operation: "exam_resume" });
    const [entry] = await diagnosticsRepository.query({ correlationId: "corr-oauth-environment", outcome: "failure" });

    expect(result).toEqual({ actionableEnvironmentId: null });
    expect(entry).toMatchObject({
      request: null,
      response: null,
      details: { attemptedOperation: "list_training_participants", integrationSurface: "cloudshare.v4.oauth.token", failureMode: "rate_limit", responseStatus: 429 },
    });
    expect(JSON.stringify(entry)).not.toMatch(/private-secret|private-token/);
  });
});
