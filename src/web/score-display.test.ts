import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { ScoreErrorPanel, ScoreLoadedPanel } from "./score-display";

describe("ScoreLoadedPanel", () => {
  const originalTimezone = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTimezone;
  });

  it("renders pass rate as the headline score with completion demoted to supporting evidence", () => {
    process.env.TZ = "Europe/London";

    const html = renderToStaticMarkup(
      createElement(ScoreLoadedPanel, {
        score: {
          examAttemptId: "attempt-1",
          examTitle: "Helios Guided Journey",
          scheduledFor: "2026-06-18T09:00:00.000Z",
          experienceId: "exp-1",
          scoreRetrievalEnabled: true,
          scoreAvailable: true,
          percentComplete: 82,
          stepsCompleted: 9,
          stepsTotal: 11,
          exploredRate: 0.82,
          inProgressRate: 0.09,
          notStartedRate: 0.09,
          passedRate: 0.55,
          failedRate: 0.18,
          notInitiatedRate: 0.18,
          retrievedAt: "2026-06-18T10:30:00.000Z",
          steps: [
            { stepId: "step-1", title: "Create the queue", completed: true, status: "passed" },
            { stepId: "step-2", title: "Verify the workflow", completed: false, status: "in_progress" },
          ],
          limitations: [
            "Bitmap checkpoints only.",
            "Only the final state is assessed.",
          ],
        },
      }),
    );

    expect(html).toContain("Completion summary");
    expect(html).toContain("Helios Guided Journey");
    expect(html).toContain("Exam attempt: attempt-1");
    expect(html).toContain("55% pass rate");
    expect(html).toContain("9 of 11");
    expect(html.indexOf("55% pass rate")).toBeLessThan(html.indexOf("9 of 11"));
    expect(html).toContain("Passed rate");
    expect(html).toContain("Last retrieved");
    expect(html).toContain("2026-06-18 11:30");
    expect(html).not.toContain("6/18/2026");
    expect(html).toContain("Step progress");
    expect(html).toContain("Create the queue");
    expect(html).toContain("Scoring limitations");
  });

  it("renders score details and step progress as compact rows", () => {
    const html = renderToStaticMarkup(
      createElement(ScoreLoadedPanel, {
        score: {
          examAttemptId: "attempt-compact",
          examTitle: "Helios Guided Journey",
          scheduledFor: "2026-06-18T09:00:00.000Z",
          experienceId: "exp-compact",
          scoreRetrievalEnabled: true,
          scoreAvailable: true,
          percentComplete: 82,
          stepsCompleted: 9,
          stepsTotal: 11,
          exploredRate: 0.82,
          inProgressRate: 0.09,
          notStartedRate: 0.09,
          passedRate: 0.55,
          failedRate: 0.18,
          notInitiatedRate: 0.18,
          retrievedAt: "2026-06-18T10:30:00.000Z",
          steps: [
            { stepId: "step-1", title: "Create the queue", completed: true, status: "passed" },
            { stepId: "step-2", title: "Verify the workflow", completed: false, status: "in_progress" },
          ],
          limitations: ["Only the final state is assessed."],
        },
      }),
    );

    expect(html).toContain('aria-label="Score summary details"');
    expect(html).toContain('aria-label="Metric breakdown"');
    expect(html).toContain('aria-label="Step progress rows"');
    expect(html).toContain("grid-template-columns:minmax(0,1fr) auto");
    expect(html).toContain("white-space:nowrap");
    expect(html).toContain("align-items:center");
  });

  it("keeps the completion shell, message, and limitations when no Guided Journey score is available", () => {
    const html = renderToStaticMarkup(
      createElement(ScoreLoadedPanel, {
        score: {
          examAttemptId: "attempt-2",
          examTitle: "Helios Guided Journey",
          scheduledFor: "2026-06-18T09:00:00.000Z",
          experienceId: "exp-2",
          scoreRetrievalEnabled: true,
          scoreAvailable: false,
          reason: "no_guided_journey_score",
          message: "No Guided Journey score is available for this Exam attempt.",
          retrievedAt: "2026-06-18T10:30:00.000Z",
          limitations: ["Only the final state is assessed."],
        },
      }),
    );

    expect(html).toContain("Completion summary");
    expect(html).toContain("No score available");
    expect(html).toContain("No Guided Journey score is available for this Exam attempt.");
    expect(html).toContain("Exam attempt: attempt-2");
    expect(html).toContain("Scoring limitations");
    expect(html).not.toContain("Metric tiles");
    expect(html).not.toContain("Step progress");
  });
});

describe("ScoreErrorPanel", () => {
  it("preserves the supportable error message when score retrieval fails", () => {
    const html = renderToStaticMarkup(
      createElement(ScoreErrorPanel, {
        errorMessage: "request failed (502). Reference: corr-123",
      }),
    );

    expect(html).toContain("Score unavailable");
    expect(html).toContain("Could not load score: request failed (502). Reference: corr-123");
  });
});
