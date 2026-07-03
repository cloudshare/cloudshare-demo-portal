import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  confirmCandidateEndExam,
  END_EXAM_CONFIRMATION_MESSAGE,
  getEndExamPendingLaunchState,
  LabLauncher,
} from "./lab-launcher";

describe("LabLauncher", () => {
  it("offers End exam for in-progress and suspended attempts", () => {
    const inProgressHtml = renderToStaticMarkup(
      createElement(LabLauncher, {
        examAttemptId: "attempt-1",
        currentAttemptStatus: "in_progress",
      }),
    );
    const suspendedHtml = renderToStaticMarkup(
      createElement(LabLauncher, {
        examAttemptId: "attempt-1",
        currentAttemptStatus: "suspended",
      }),
    );

    expect(inProgressHtml).toContain("End exam");
    expect(suspendedHtml).toContain("End exam");
  });

  it("warns Candidates that ending an exam archives the lab and removes access", () => {
    const confirm = vi.fn().mockReturnValue(false);

    expect(confirmCandidateEndExam(confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(END_EXAM_CONFIRMATION_MESSAGE);
    expect(END_EXAM_CONFIRMATION_MESSAGE).toBe(
      "Ending this exam will allow you to get your results immediately, but also archive your CloudShare lab. This means you will lose access to this exam attempt, which cannot be undone.",
    );
    expect(END_EXAM_CONFIRMATION_MESSAGE).not.toContain("ExamAttempt");
  });

  it("keeps a retryable completion-pending state when archive succeeded but completion is still pending", () => {
    expect(
      getEndExamPendingLaunchState({
        environmentArchived: true,
        labStatus: {
          examAttemptId: "attempt-1",
          examTitle: "Helios Guided Journey",
          timeLimitMinutes: 60,
          status: "in_progress",
          scheduledFor: "2026-06-18T09:00:00.000Z",
        },
      }),
    ).toBe("completion_pending");
  });
});
