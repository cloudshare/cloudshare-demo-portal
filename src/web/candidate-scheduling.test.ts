import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  isPortalSessionExpiredError,
  joinCandidateCohortSession,
  loadCandidateDashboard,
  scheduleCandidateExam,
  shouldShowNoPublishedExams,
  shouldShowPublishedExamList,
} from "./candidate-scheduling";

describe("candidate scheduling client", () => {
  const originalTimezone = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = "Europe/London";
  });

  afterAll(() => {
    process.env.TZ = originalTimezone;
  });

  it("loads the candidate dashboard from the candidate exams API", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        exams: [
          {
            id: "exam-1",
            title: "Exam",
            description: "",
            timeLimitMinutes: 90,
            storageLeaseMinutes: null,
            openPeriodMinutes: 120,
          },
        ],
        attempts: [{ id: "attempt-1", examId: "exam-1", scheduledFor: "2026-06-15T16:00:00.000Z", status: "ready" }],
      }),
    });

    const result = await loadCandidateDashboard(fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith("/api/candidate/exams");
    expect(result.attempts[0]?.status).toBe("ready");
  });

  it("posts scheduling requests through the candidate exams API", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        attempt: {
          id: "attempt-1",
          examId: "exam-1",
          scheduledFor: "2026-06-15T16:00:00.000Z",
          status: "ready",
        },
        coldStartLikely: false,
        correlationId: "corr-1",
      }),
    });

    const result = await scheduleCandidateExam(fetchImpl, {
      examId: "exam-1",
      scheduledFor: "2026-06-15T16:00:00.000Z",
    });

    expect(fetchImpl).toHaveBeenCalledWith("/api/candidate/exams", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        examId: "exam-1",
        scheduledFor: "2026-06-15T16:00:00.000Z",
      }),
    });
    expect(result.correlationId).toBe("corr-1");
  });

  it("posts cohort-session join requests through the candidate cohort join API", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        attempt: {
          id: "attempt-1",
          examId: "exam-1",
          cohortSessionId: "cohort-session-1",
          scheduledFor: "2026-07-05T10:00:00.000Z",
          status: "ready",
        },
        correlationId: "corr-cohort-1",
      }),
    });

    const result = await joinCandidateCohortSession(fetchImpl, {
      examId: "exam-1",
      cohortSessionId: "cohort-session-1",
    });

    expect(fetchImpl).toHaveBeenCalledWith("/api/candidate/exams/cohort-sessions/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        examId: "exam-1",
        cohortSessionId: "cohort-session-1",
      }),
    });
    expect(result.correlationId).toBe("corr-cohort-1");
  });

  it("fails fast if a candidate-facing response leaks loginUrl", async () => {
    await expect(
      loadCandidateDashboard(
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            exams: [],
            attempts: [],
            loginUrl: "https://use.cloudshare.com/secret",
          }),
        }),
      ),
    ).rejects.toThrow(/loginUrl/);
  });

  it("fails fast if a cohort join response leaks loginUrl", async () => {
    await expect(
      joinCandidateCohortSession(
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            attempt: {
              id: "attempt-1",
              examId: "exam-1",
              cohortSessionId: "cohort-session-1",
              scheduledFor: "2026-07-05T10:00:00.000Z",
              status: "ready",
            },
            loginUrl: "https://use.cloudshare.com/secret",
          }),
        }),
        {
          examId: "exam-1",
          cohortSessionId: "cohort-session-1",
        },
      ),
    ).rejects.toThrow(/loginUrl/);
  });

  it("maps unauthorized candidate dashboard responses to a session-expired error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        error: "Unauthorized",
      }),
    });

    const error = await loadCandidateDashboard(fetchImpl).catch((cause: unknown) => cause);

    expect(isPortalSessionExpiredError(error)).toBe(true);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("session has expired");
    expect((error as Error).message).not.toContain("Unauthorized");
  });

  it("keeps published exams visible when a scheduling error is shown", () => {
    expect(shouldShowPublishedExamList({ loading: false, examCount: 1 })).toBe(true);
    expect(shouldShowNoPublishedExams({ loading: false, examCount: 1 })).toBe(false);
  });

  it("includes the support correlation ID in scheduling errors", async () => {
    await expect(
      scheduleCandidateExam(
        vi.fn().mockResolvedValue({
          ok: false,
          json: async () => ({
            error: "CloudShare provisioning failed for the scheduled exam.",
            correlationId: "corr-123",
          }),
        }),
        {
          examId: "exam-1",
          scheduledFor: "2026-06-15T16:00:00.000Z",
        },
      ),
    ).rejects.toThrow(
      "CloudShare provisioning failed for the scheduled exam. Reference ID: corr-123.",
    );
  });

  it("surfaces overlapping-attempt scheduling copy with the next available time", async () => {
    await expect(
      scheduleCandidateExam(
        vi.fn().mockResolvedValue({
          ok: false,
          status: 409,
          json: async () => ({
            error:
              "Another attempt for this Exam is still active or available. You can schedule this Exam again after 2026-06-15T17:30:00.000Z.",
            code: "exam_attempt_overlap",
            nextAvailableAt: "2026-06-15T17:30:00.000Z",
          }),
        }),
        {
          examId: "exam-1",
          scheduledFor: "2026-06-15T17:00:00.000Z",
        },
      ),
    ).rejects.toThrow(
      "Another attempt for this Exam is still active or available. You can schedule this Exam again after 2026-06-15 18:30.",
    );
  });
});
