import { describe, expect, it, vi } from "vitest";
import {
  loadCandidateDashboard,
  scheduleCandidateExam,
  shouldShowNoPublishedExams,
  shouldShowPublishedExamList,
} from "./candidate-scheduling";

describe("candidate scheduling client", () => {
  it("loads the candidate dashboard from the candidate exams API", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        exams: [{ id: "exam-1", title: "Exam", description: "", timeLimitMinutes: 90 }],
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
});
