import { describe, expect, it, vi } from "vitest";
import {
  loadCandidateLabStatus,
  preflightLabAction,
  resumeLabAttempt,
  suspendLabAttempt,
} from "./lab-launcher-client";

describe("lab launcher client helpers", () => {
  it("blocks enter preflight for a future-scheduled ready attempt before any child-window open path can start", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        examAttemptId: "attempt-2",
        examTitle: "Helios Guided Journey",
        timeLimitMinutes: 60,
        status: "ready",
        scheduledFor: "2026-06-18T10:00:00.000Z",
      }),
    });

    const result = await preflightLabAction(fetchImpl, {
      examAttemptId: "attempt-2",
      action: "enter",
      now: () => new Date("2026-06-18T09:59:00.000Z"),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/exam/status?examAttemptId=attempt-2",
      { cache: "no-store" },
    );
    expect(result).toEqual({
      kind: "blocked",
      labStatus: {
        examAttemptId: "attempt-2",
        examTitle: "Helios Guided Journey",
        timeLimitMinutes: 60,
        status: "ready",
        scheduledFor: "2026-06-18T10:00:00.000Z",
      },
      message: "Exam entry is not available before the scheduled start time.",
    });
  });

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

  it("allows resume preflight to re-enter when the authoritative attempt status is already in progress", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        examAttemptId: "attempt-1",
        examTitle: "Helios Guided Journey",
        timeLimitMinutes: 60,
        status: "in_progress",
        scheduledFor: "2026-06-18T09:00:00.000Z",
      }),
    });

    const result = await preflightLabAction(fetchImpl, {
      examAttemptId: "attempt-1",
      action: "resume",
    });

    expect(result).toEqual({
      kind: "proceed",
      labStatus: {
        examAttemptId: "attempt-1",
        examTitle: "Helios Guided Journey",
        timeLimitMinutes: 60,
        status: "in_progress",
        scheduledFor: "2026-06-18T09:00:00.000Z",
      },
    });
  });

  it("treats a resume POST that reports already_active as a successful recovery path", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: "resumed",
        resumeDisposition: "already_active",
        examAttemptId: "attempt-1",
      }),
    });

    const result = await resumeLabAttempt(fetchImpl, "attempt-1");

    expect(fetchImpl).toHaveBeenCalledWith("/api/exam/resume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ examAttemptId: "attempt-1" }),
    });
    expect(result).toEqual({
      kind: "resumed",
      disposition: "already_active",
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
