import { describe, expect, it, vi } from "vitest";
import { createDiagnosticRecorder } from "@/domain/diagnostic-log";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import {
  recordExamAttemptCompletionDiagnostic,
  recordExamAttemptCompletionEnvironmentDiagnostic,
} from "./exam-attempt-completion-diagnostics";

describe("exam attempt completion diagnostics", () => {
  it("records the authoritative CloudShare environment state after portal runtime completion", async () => {
    const repository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository });
    const source = {
      getEnvironmentState: vi.fn(async (environmentExternalId: string) => ({
        environmentExternalId,
        status: "running" as const,
        request: {
          method: "GET",
          path: `/v4/environments/${environmentExternalId}`,
          headers: {
            authorization: "cs_sha1 userapiid:api-id;timestamp:123;token:[REDACTED];hmac:[REDACTED]",
          },
        },
        response: {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
          body: {
            envId: environmentExternalId,
            envStatus: "Archived",
          },
        },
      })),
    };

    const attempt = {
      id: "attempt-1",
      customerId: "customer-1",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "completed" as const,
      scheduledFor: new Date("2026-06-24T19:17:00.000Z"),
      createdAt: new Date("2026-06-24T19:16:44.432Z"),
    };

    await recordExamAttemptCompletionDiagnostic(
      diagnostics,
      attempt,
      "candidate4@myplace.demo",
    );
    await recordExamAttemptCompletionEnvironmentDiagnostic(
      { diagnostics, source },
      {
        attempt,
        candidateEmail: "candidate4@myplace.demo",
        completionReason: "heartbeat_reconciliation",
        launch: {
          id: "launch-1",
          examAttemptId: "attempt-1",
          candidateId: "candidate-1",
          participantEmail: "candidate4@myplace.demo",
          trainingId: "training-1",
          experienceId: "training-1",
          environmentExternalId: "ENN_FkNYEmuHdXixiVS-Kfcw2",
          environmentId: "ENN_FkNYEmuHdXixiVS-Kfcw2",
          loginUrl: "https://use.cloudshare.test/sponsored",
          status: "launched",
          createdAt: new Date("2026-06-24T19:16:47.084Z"),
        },
      },
    );

    expect(source.getEnvironmentState).toHaveBeenCalledWith("ENN_FkNYEmuHdXixiVS-Kfcw2");
    await expect(repository.query({ examAttemptId: "attempt-1" })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "exam_attempt.complete",
          outcome: "success",
          candidateEmail: "candidate4@myplace.demo",
        }),
        expect.objectContaining({
          operation: "cloudshare.environment.completion_reconcile",
          outcome: "success",
          candidateEmail: "candidate4@myplace.demo",
          externalIds: expect.objectContaining({
            environmentExternalId: "ENN_FkNYEmuHdXixiVS-Kfcw2",
            environmentStatus: "running",
            trainingId: "training-1",
          }),
          details: expect.objectContaining({
            completionReason: "heartbeat_reconciliation",
            attemptedOperation: "get_environment",
            integrationSurface: "cloudshare.v4.environments.get",
            environmentFound: true,
          }),
          request: {
            method: "GET",
            path: "/v4/environments/ENN_FkNYEmuHdXixiVS-Kfcw2",
            headers: {
              authorization: "[REDACTED]",
            },
          },
          response: {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
            body: {
              envId: "ENN_FkNYEmuHdXixiVS-Kfcw2",
              envStatus: "Archived",
            },
          },
        }),
      ]),
    );
  });
});
