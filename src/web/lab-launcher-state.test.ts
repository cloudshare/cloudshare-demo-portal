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
      openPeriodEndsAt: "2026-06-19T11:00:00.000Z",
      openPeriodClosed: false,
      scoreRetrievalEnabled: true,
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
      openPeriodEndsAt: "2026-06-19T11:00:00.000Z",
      openPeriodClosed: false,
      scoreRetrievalEnabled: true,
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
      detail: "Your CloudShare lab opened in a separate window for this Exam Attempt.",
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
      supportMessage: "Resume exam to reopen your CloudShare lab and continue the same Exam Attempt.",
    });
  });

  it("keeps archived completion persistence pending as a retryable state", () => {
    expect(
      getLauncherPresentation({
        state: "completion_pending",
        attemptStatus: "in_progress",
        message: "Your CloudShare lab is archived, but completion is still being saved. Retry End exam.",
      }),
    ).toEqual({
      tone: "info",
      title: "Completion pending",
      detail: "Your CloudShare lab is archived, but completion is still being saved. Retry End exam.",
      primaryActionLabel: null,
      supportMessage: null,
    });
  });

  it("uses readable Exam Attempt copy while completion is being archived", () => {
    expect(getLauncherPresentation({
      state: "ending",
      attemptStatus: "in_progress",
      message: "",
    }).detail).toBe("The portal is archiving your CloudShare lab before completing this Exam Attempt.");
  });

  it("suppresses launch and resume recovery once the authored open period has closed", () => {
    expect(getLauncherRecoveryAction("suspended", true)).toBeNull();
    expect(
      getLauncherPresentation({
        state: "suspended",
        attemptStatus: "suspended",
        openPeriodClosed: true,
        message: "",
      }),
    ).toEqual({
      tone: "info",
      title: "Exam open period closed",
      detail: "This Exam open period has closed. Return to Candidate Home to review available score actions.",
      primaryActionLabel: null,
      supportMessage: null,
    });
  });

  it("shows blocked entry as a terminal warning without retry controls", () => {
    expect(
      getLauncherPresentation({
        state: "blocked",
        attemptStatus: "ready",
        message:
          "Exam entry is temporarily unavailable because the lab configuration changed. Contact your administrator.",
      }),
    ).toEqual({
      tone: "error",
      title: "Exam entry unavailable",
      detail:
        "Exam entry is temporarily unavailable because the lab configuration changed. Contact your administrator.",
      primaryActionLabel: null,
      supportMessage:
        "Your exam attempt has not started. Contact your administrator before trying again.",
    });
  });
});
