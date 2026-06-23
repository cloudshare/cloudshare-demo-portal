import { describe, expect, it, vi } from "vitest";
import { describeAndReportLaunchFailure } from "./lab-launcher-runtime-diagnostics";

describe("lab launcher runtime diagnostics", () => {
  it("reports popup-blocked launcher recovery to the candidate runtime diagnostics route", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ ok: true }),
    });

    const message = await describeAndReportLaunchFailure(fetchImpl, {
      error: new Error('Lab window for "ea-1" could not be opened (popup blocked?)'),
      examAttemptId: "ea-1",
      attemptedAction: "open",
      attemptStatus: "in_progress",
    });

    expect(message).toBe(
      "The exam window was blocked by your browser. Allow popups for this site, then use Open exam window to retry.",
    );
    expect(fetchImpl).toHaveBeenCalledWith("/api/candidate/runtime-diagnostics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        examAttemptId: "ea-1",
        attemptedAction: "open",
        attemptStatus: "in_progress",
        failureReason: "popup_blocked",
        candidateMessage:
          "The exam window was blocked by your browser. Allow popups for this site, then use Open exam window to retry.",
      }),
    });
  });

  it("keeps launcher recovery candidate-safe when diagnostic recording fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "write failed" }),
    });

    await expect(
      describeAndReportLaunchFailure(fetchImpl, {
        error: new Error('Lab window for "ea-2" could not be opened (popup blocked?)'),
        examAttemptId: "ea-2",
        attemptedAction: "resume",
        attemptStatus: "suspended",
      }),
    ).resolves.toBe(
      "The exam window was blocked by your browser. Allow popups for this site, then try again.",
    );
  });
});
