import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LabLauncher } from "./lab-launcher";

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
});
