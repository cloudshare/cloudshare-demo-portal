import { describe, expect, it, vi } from "vitest";
import { handleRecordCandidateLabLaunchFailure } from "./candidate-runtime-diagnostics";

describe("handleRecordCandidateLabLaunchFailure", () => {
  it("records a candidate-safe popup-blocked runtime diagnostic anchored to the exam attempt", async () => {
    const diagnostics = { record: vi.fn().mockResolvedValue(undefined) };

    const response = await handleRecordCandidateLabLaunchFailure(
      { diagnostics },
      {
        attempt: {
          id: "ea-1",
          customerId: "customer-1",
          candidateId: "candidate-1",
          examId: "exam-1",
          status: "in_progress",
          scheduledFor: new Date("2026-06-23T08:00:00.000Z"),
          createdAt: new Date("2026-06-23T07:00:00.000Z"),
        },
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        attemptedAction: "resume",
        failureReason: "popup_blocked",
        candidateMessage:
          "The exam window was blocked by your browser. Allow popups for this site, then try again.",
        reportedAttemptStatus: "suspended",
      },
    );

    expect(response).toEqual({
      status: 202,
      body: { ok: true },
    });
    expect(diagnostics.record).toHaveBeenCalledWith({
      source: "runtime",
      level: "warn",
      operation: "candidate.lab_launch.popup_blocked",
      outcome: "failure",
      customerId: "customer-1",
      candidateEmail: "candidate@helioscx.demo",
      examId: "exam-1",
      examAttemptId: "ea-1",
      actor: {
        type: "candidate",
        id: "candidate-1",
        email: "candidate@helioscx.demo",
      },
      subject: {
        type: "exam_attempt",
        id: "ea-1",
      },
      message: "Candidate lab window was blocked by the browser",
      details: {
        attemptedAction: "resume",
        attemptStatus: "in_progress",
        reportedAttemptStatus: "suspended",
        failureReason: "popup_blocked",
        candidateMessage:
          "The exam window was blocked by your browser. Allow popups for this site, then try again.",
        route: "/api/candidate/runtime-diagnostics",
      },
    });
  });
});
