import { describe, expect, it } from "vitest";
import {
  getAttemptStatusAfterLaunchTransition,
  getLauncherPresentation,
  getLauncherRecoveryAction,
  getLauncherSyncTarget,
  updateCandidateLabStatus,
  updateCandidateLabStatusAttemptState,
} from "./lab-launcher-state";

describe("lab launcher state helpers", () => {
  it("reuses the existing lab status object when a loaded status payload is unchanged", () => {
    const current = {
      examAttemptId: "attempt-1",
      examTitle: "Helios Guided Journey",
      timeLimitMinutes: 60,
      status: "completed" as const,
      scheduledFor: "2026-06-19T09:00:00.000Z",
    };

    expect(updateCandidateLabStatus(current, { ...current })).toBe(current);
  });

  it("avoids creating a new lab status object when the attempt status is already settled", () => {
    const current = {
      examAttemptId: "attempt-1",
      examTitle: "Helios Guided Journey",
      timeLimitMinutes: 60,
      status: "completed" as const,
      scheduledFor: "2026-06-19T09:00:00.000Z",
    };

    expect(updateCandidateLabStatusAttemptState(current, "completed")).toBe(current);
  });

  it("maps completed and suspended attempt statuses to idempotent launcher sync targets", () => {
    expect(getLauncherSyncTarget("completed")).toEqual({
      state: "completed",
      message: "Examination complete.",
    });
    expect(getLauncherSyncTarget("suspended")).toEqual({
      state: "suspended",
      message: "Lab suspended.",
    });
    expect(getLauncherSyncTarget("ready")).toBeNull();
  });

  it("maps recovery actions to the authoritative attempt status after launch or popup errors", () => {
    expect(getLauncherRecoveryAction("ready")).toEqual({
      action: "enter",
      label: "Enter exam",
    });
    expect(getLauncherRecoveryAction("in_progress")).toEqual({
      action: "reopen",
      label: "Open exam window",
    });
    expect(getLauncherRecoveryAction("suspended")).toEqual({
      action: "resume",
      label: "Resume exam",
    });
    expect(getLauncherRecoveryAction("completed")).toBeNull();
  });

  it("promotes a resumed attempt to in-progress before popup recovery is rendered", () => {
    expect(getAttemptStatusAfterLaunchTransition("suspended", "resume")).toBe("in_progress");
    expect(getAttemptStatusAfterLaunchTransition("ready", "enter")).toBe("ready");
    expect(getAttemptStatusAfterLaunchTransition("in_progress", "resume")).toBe("in_progress");
  });

  it("surfaces an obvious recovery banner for popup-blocked launcher errors", () => {
    expect(
      getLauncherPresentation({
        state: "error",
        attemptStatus: "in_progress",
        message:
          "The exam window was blocked by your browser. Allow popups for this site, then use Open exam window to retry.",
      }),
    ).toMatchObject({
      tone: "error",
      title: "Recover your exam window",
      detail:
        "The exam window was blocked by your browser. Allow popups for this site, then use Open exam window to retry.",
      primaryActionLabel: "Open exam window",
      supportMessage: null,
    });
  });

  it("keeps core launch controls prominent while the lab is open", () => {
    expect(
      getLauncherPresentation({
        state: "open",
        attemptStatus: "in_progress",
        message: "",
      }),
    ).toEqual({
      tone: "info",
      title: "Exam window open",
      detail: "Your CloudShare lab opened in a separate window for this ExamAttempt.",
      primaryActionLabel: "Suspend lab",
      supportMessage:
        "Leaving or closing this page without suspending keeps your lab running and consuming time. Use Suspend lab to pause before stepping away.",
    });
  });

  it("keeps suspended attempts on a resume-focused recovery path", () => {
    expect(
      getLauncherPresentation({
        state: "suspended",
        attemptStatus: "suspended",
        message: "Lab suspended. You can resume your session when ready.",
      }),
    ).toEqual({
      tone: "info",
      title: "Lab suspended",
      detail: "Lab suspended. You can resume your session when ready.",
      primaryActionLabel: "Resume exam",
      supportMessage: "Resume exam to reopen your CloudShare lab and continue the same ExamAttempt.",
    });
  });
});
