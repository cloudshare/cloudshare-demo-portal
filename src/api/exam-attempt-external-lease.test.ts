import { describe, expect, it, vi } from "vitest";
import {
  recordExamAttemptExternalLeaseInspectionFailure,
  type CloudShareLeaseInspection,
} from "./exam-attempt-external-lease";

describe("recordExamAttemptExternalLeaseInspectionFailure", () => {
  it("persists cached-prior response evidence state for a rate-limited lease read", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const inspection = {
      kind: "unknown",
      target: "environment",
      attemptedOperation: "get_environment",
      integrationSurface: "cloudshare.v3.env.get",
      method: "GET",
      path: "/v3/envs/ENVS-1",
      failureMode: "rate_limit",
      responseStatus: 429,
      responseEvidence: "cached_prior",
      examAttemptId: "attempt-1",
      trainingId: null,
      experienceId: null,
      environmentExternalId: "ENVS-1",
    } satisfies CloudShareLeaseInspection;

    await recordExamAttemptExternalLeaseInspectionFailure(
      { diagnostics: { record } },
      {
        inspection,
        source: "candidate-enter",
        actorType: "candidate",
        message: "CloudShare requests are cooling down",
        correlationId: "lease-operation-1",
      },
    );

    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      operation: "cloudshare.exam_attempt_external_lease.read",
      correlationId: "lease-operation-1",
      details: expect.objectContaining({
        failureMode: "rate_limit",
        responseEvidence: "cached_prior",
      }),
    }));
  });
});
