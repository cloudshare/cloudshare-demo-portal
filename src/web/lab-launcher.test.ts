import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { confirmCandidateEndExam, END_EXAM_CONFIRMATION_MESSAGE, LabLauncher } from "./lab-launcher";

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
    expect(END_EXAM_CONFIRMATION_MESSAGE).toContain("archive your CloudShare lab");
    expect(END_EXAM_CONFIRMATION_MESSAGE).toContain("lose access");
  });
});
