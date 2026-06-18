import { describe, expect, it, vi } from "vitest";
import {
  loadCandidateLabStatus,
  preflightLabAction,
  suspendLabAttempt,
} from "./lab-launcher-client";

describe("lab launcher client helpers", () => {
  it("does not allow enter to open when status preflight already shows completion", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        examAttemptId: "attempt-1",
        examTitle: "Helios Guided Journey",
        timeLimitMinutes: 60,
        status: "completed",
        scheduledFor: "2026-06-18T09:00:00.000Z",
      }),
    });

    const result = await preflightLabAction(fetchImpl, {
      examAttemptId: "attempt-1",
      action: "enter",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/exam/status?examAttemptId=attempt-1",
      { cache: "no-store" },
    );
    expect(result).toEqual({
      kind: "completed",
      labStatus: {
        examAttemptId: "attempt-1",
        examTitle: "Helios Guided Journey",
        timeLimitMinutes: 60,
        status: "completed",
        scheduledFor: "2026-06-18T09:00:00.000Z",
      },
      message: "Examination complete.",
    });
  });

  it("refreshes authoritative status after a suspend 409 so the lab UI can settle to completed", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          error: "Exam attempt is not in a valid status for this transition",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          examAttemptId: "attempt-1",
          examTitle: "Helios Guided Journey",
          timeLimitMinutes: 60,
          status: "completed",
          scheduledFor: "2026-06-18T09:00:00.000Z",
        }),
      });

    const result = await suspendLabAttempt(fetchImpl, "attempt-1");

    expect(result).toEqual({
      kind: "completed",
      labStatus: {
        examAttemptId: "attempt-1",
        examTitle: "Helios Guided Journey",
        timeLimitMinutes: 60,
        status: "completed",
        scheduledFor: "2026-06-18T09:00:00.000Z",
      },
      message: "Examination complete.",
    });
  });

  it("surfaces a candidate-safe error when lab status cannot be loaded", async () => {
    await expect(
      loadCandidateLabStatus(
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          json: async () => ({ error: "exam attempt not found" }),
        }),
        "attempt-missing",
      ),
    ).rejects.toThrow("exam attempt not found");
  });
});
