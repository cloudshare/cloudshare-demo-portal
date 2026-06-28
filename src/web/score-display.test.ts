import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScoreErrorPanel, ScoreLoadedPanel } from "./score-display";

describe("ScoreLoadedPanel", () => {
  it("renders a clear completion summary with metrics, steps, limitations, and candidate actions when a score is available", () => {
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
        logoutPresentation: {
          buttonLabel: "Log out",
          disabled: false,
          statusMessage: null,
          errorMessage: null,
        },
        onBackToCandidateHome: () => {},
        onLogout: () => Promise.resolve(),
      }),
    );

    expect(html).toContain("Completion summary");
    expect(html).toContain("Helios Guided Journey");
    expect(html).toContain("Exam attempt: attempt-1");
    expect(html).toContain("82% complete");
    expect(html).toContain("9 of 11");
    expect(html).toContain("Passed rate");
    expect(html).toContain("Step progress");
    expect(html).toContain("Create the queue");
    expect(html).toContain("Scoring limitations");
    expect(html).toContain("Back to Candidate Home");
    expect(html).toContain("Log out");
  });

  it("keeps the completion shell, message, limitations, and actions when no Guided Journey score is available", () => {
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
        logoutPresentation: {
          buttonLabel: "Log out",
          disabled: false,
          statusMessage: null,
          errorMessage: null,
        },
        onBackToCandidateHome: () => {},
        onLogout: () => Promise.resolve(),
      }),
    );

    expect(html).toContain("Completion summary");
    expect(html).toContain("No score available");
    expect(html).toContain("No Guided Journey score is available for this Exam attempt.");
    expect(html).toContain("Exam attempt: attempt-2");
    expect(html).toContain("Scoring limitations");
    expect(html).toContain("Back to Candidate Home");
    expect(html).toContain("Log out");
    expect(html).not.toContain("Metric tiles");
    expect(html).not.toContain("Step progress");
  });
});

describe("ScoreErrorPanel", () => {
  it("preserves the candidate recovery actions when score retrieval fails", () => {
    const html = renderToStaticMarkup(
      createElement(ScoreErrorPanel, {
        errorMessage: "request failed (502). Reference: corr-123",
        logoutPresentation: {
          buttonLabel: "Try log out again",
          disabled: false,
          statusMessage: null,
          errorMessage: "Logout failed (502)",
        },
        onBackToCandidateHome: () => {},
        onLogout: () => Promise.resolve(),
      }),
    );

    expect(html).toContain("Score unavailable");
    expect(html).toContain("Could not load score: request failed (502). Reference: corr-123");
    expect(html).toContain("Back to Candidate Home");
    expect(html).toContain("Try log out again");
    expect(html).toContain("Logout failed (502)");
  });
});
