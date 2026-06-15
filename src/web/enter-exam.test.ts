import { describe, expect, it } from "vitest";
import { buildEnterExamUrl, openEnterExamWindow } from "./enter-exam";

describe("enter exam window", () => {
  it("opens a child window to the portal /enter endpoint, not a sponsored link", () => {
    const opened: { url?: string; target?: string } = {};

    openEnterExamWindow("attempt-1", (url, target) => {
      opened.url = url;
      opened.target = target;
      return { closed: false, close() {} };
    });

    expect(opened).toEqual({
      url: "/enter?examAttemptId=attempt-1",
      target: "lab_attempt-1",
    });
  });

  it("builds a stable portal entry URL for the exam attempt", () => {
    expect(buildEnterExamUrl("attempt-1")).toBe("/enter?examAttemptId=attempt-1");
  });
});
