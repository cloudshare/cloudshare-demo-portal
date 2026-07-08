import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  confirmCandidateEndExam,
  END_EXAM_CONFIRMATION_MESSAGE,
  getEndExamPendingLaunchState,
  getRetainedWindowLaunchState,
  LabLauncher,
  readEnterBlockedMessage,
} from "./lab-launcher";
import { clearLabWindows, openLabWindow } from "./lab-window";

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

  it("treats an in-progress attempt with a retained child window as open", () => {
    clearLabWindows();
    openLabWindow("attempt-joined", "/enter?examAttemptId=attempt-joined", () => ({
      closed: false,
      close: vi.fn(),
    }));

    const html = renderToStaticMarkup(
      createElement(LabLauncher, {
        examAttemptId: "attempt-joined",
        currentAttemptStatus: "in_progress",
      }),
    );

    expect(html).toContain("Exam window open");
    expect(html).toContain("Suspend lab");
    clearLabWindows();
  });

  it("opens monitoring when a ready attempt receives in-progress status with a retained child window", () => {
    clearLabWindows();
    openLabWindow("attempt-transition", "/enter?examAttemptId=attempt-transition", () => ({
      closed: false,
      close: vi.fn(),
    }));

    expect(
      getRetainedWindowLaunchState({
        examAttemptId: "attempt-transition",
        currentAttemptStatus: "in_progress",
        currentLaunchState: "idle",
      }),
    ).toBe("open");
    clearLabWindows();
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

  it("accepts same-origin blocked entry handoff messages for the current attempt", () => {
    expect(
      readEnterBlockedMessage(
        {
          origin: "http://localhost:3000",
          data: {
            type: "certalis:exam-entry-blocked",
            examAttemptId: "attempt-1",
            status: 423,
            message:
              "Exam entry is temporarily unavailable because the lab configuration changed. Contact your administrator.",
          },
        } as MessageEvent,
        {
          expectedOrigin: "http://localhost:3000",
          examAttemptId: "attempt-1",
        },
      ),
    ).toEqual({
      status: 423,
      message:
        "Exam entry is temporarily unavailable because the lab configuration changed. Contact your administrator.",
    });
  });

  it("ignores blocked entry handoff messages from another origin or attempt", () => {
    const payload = {
      type: "certalis:exam-entry-blocked",
      examAttemptId: "attempt-1",
      status: 423,
      message: "Blocked.",
    };

    expect(
      readEnterBlockedMessage(
        { origin: "https://evil.example", data: payload } as MessageEvent,
        {
          expectedOrigin: "http://localhost:3000",
          examAttemptId: "attempt-1",
        },
      ),
    ).toBeNull();
    expect(
      readEnterBlockedMessage(
        { origin: "http://localhost:3000", data: payload } as MessageEvent,
        {
          expectedOrigin: "http://localhost:3000",
          examAttemptId: "attempt-2",
        },
      ),
    ).toBeNull();
  });
});
