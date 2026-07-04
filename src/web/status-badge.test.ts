import { describe, expect, it } from "vitest";
import {
  getDiagnosticLevelTone,
  getExamAttemptStatusTone,
  getExamStatusTone,
  getOutcomeTone,
  statusBadgeStyle,
} from "./status-badge";

describe("status badge", () => {
  it("gives every tone a fully rounded pill shape", () => {
    (["neutral", "info", "positive", "warning", "negative"] as const).forEach((tone) => {
      expect(statusBadgeStyle(tone).borderRadius).toBe("999px");
    });
  });

  it("maps ExamAttempt statuses to distinguishable tones", () => {
    expect(getExamAttemptStatusTone("completed")).toBe("positive");
    expect(getExamAttemptStatusTone("expired")).toBe("neutral");
    expect(getExamAttemptStatusTone("suspended")).toBe("warning");
    expect(getExamAttemptStatusTone("in_progress")).toBe("warning");
    expect(getExamAttemptStatusTone("ready")).toBe("info");
    expect(getExamAttemptStatusTone("scheduled")).toBe("neutral");
  });

  it("maps Exam catalog status, audit/diagnostic outcome, and diagnostic level correctly", () => {
    expect(getExamStatusTone("published")).toBe("positive");
    expect(getExamStatusTone("draft")).toBe("neutral");
    expect(getOutcomeTone("failure")).toBe("negative");
    expect(getOutcomeTone("success")).toBe("positive");
    expect(getDiagnosticLevelTone("error")).toBe("negative");
    expect(getDiagnosticLevelTone("warn")).toBe("warning");
    expect(getDiagnosticLevelTone("info")).toBe("info");
  });
});
