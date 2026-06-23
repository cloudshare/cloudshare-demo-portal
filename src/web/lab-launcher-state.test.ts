import { describe, expect, it } from "vitest";
import {
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
});
