import { describe, expect, it, vi } from "vitest";
import {
  loadCandidateLabStatus,
  endLabAttempt,
  preflightLabAction,
  readHeartbeatAttemptStatus,
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
        openPeriodEndsAt: "2026-06-18T11:00:00.000Z",
        openPeriodClosed: false,
        scoreRetrievalEnabled: true,
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
        openPeriodEndsAt: "2026-06-18T11:00:00.000Z",
        openPeriodClosed: false,
        scoreRetrievalEnabled: true,
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
        openPeriodEndsAt: "2026-06-18T11:00:00.000Z",
        openPeriodClosed: false,
        scoreRetrievalEnabled: true,
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
        openPeriodEndsAt: "2026-06-18T11:00:00.000Z",
        openPeriodClosed: false,
        scoreRetrievalEnabled: true,
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
        openPeriodEndsAt: "2026-06-18T11:00:00.000Z",
        openPeriodClosed: false,
        scoreRetrievalEnabled: true,
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
        openPeriodEndsAt: "2026-06-18T11:00:00.000Z",
        openPeriodClosed: false,
        scoreRetrievalEnabled: true,
        status: "in_progress",
        scheduledFor: "2026-06-18T09:00:00.000Z",
      },
    });
  });

  it("blocks enter and resume preflight after the authored open period closes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        examAttemptId: "attempt-closed",
        examTitle: "Helios Guided Journey",
        timeLimitMinutes: 60,
        openPeriodEndsAt: "2026-06-18T11:00:00.000Z",
        openPeriodClosed: true,
        scoreRetrievalEnabled: true,
        status: "suspended",
        scheduledFor: "2026-06-18T09:00:00.000Z",
      }),
    });

    await expect(
      preflightLabAction(fetchImpl, {
        examAttemptId: "attempt-closed",
        action: "enter",
      }),
    ).resolves.toEqual({
      kind: "blocked",
      labStatus: {
        examAttemptId: "attempt-closed",
        examTitle: "Helios Guided Journey",
        timeLimitMinutes: 60,
        openPeriodEndsAt: "2026-06-18T11:00:00.000Z",
        openPeriodClosed: true,
        scoreRetrievalEnabled: true,
        status: "suspended",
        scheduledFor: "2026-06-18T09:00:00.000Z",
      },
      message: "Exam entry is not available after the Exam open period has closed.",
    });

    await expect(
      preflightLabAction(fetchImpl, {
        examAttemptId: "attempt-closed",
        action: "resume",
      }),
    ).resolves.toEqual({
      kind: "blocked",
      labStatus: {
        examAttemptId: "attempt-closed",
        examTitle: "Helios Guided Journey",
        timeLimitMinutes: 60,
        openPeriodEndsAt: "2026-06-18T11:00:00.000Z",
        openPeriodClosed: true,
        scoreRetrievalEnabled: true,
        status: "suspended",
        scheduledFor: "2026-06-18T09:00:00.000Z",
      },
      message: "Exam resume is not available after the Exam open period has closed.",
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

  it("rechecks authoritative status after a failed resume POST and recovers when the attempt is already back in progress", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          error: "internal error",
        }),
      })
      .mockResolvedValueOnce({
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

    const result = await resumeLabAttempt(fetchImpl, "attempt-1");

    expect(result).toEqual({
      kind: "resumed",
      disposition: "already_active",
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(2,
      "/api/exam/status?examAttemptId=attempt-1",
      { cache: "no-store" },
    );
  });

  it("maps a retryable pending resume response to a recoverable suspended state", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({
          status: "pending",
          operation: "resume",
          retryable: true,
          message: "CloudShare is still resuming your lab. Wait a few seconds, then retry Resume exam.",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          examAttemptId: "attempt-1",
          examTitle: "Helios Guided Journey",
          timeLimitMinutes: 60,
          status: "suspended",
          scheduledFor: "2026-06-18T09:00:00.000Z",
        }),
      });

    const result = await resumeLabAttempt(fetchImpl, "attempt-1");

    expect(result).toEqual({
      kind: "pending",
      labStatus: {
        examAttemptId: "attempt-1",
        examTitle: "Helios Guided Journey",
        timeLimitMinutes: 60,
        status: "suspended",
        scheduledFor: "2026-06-18T09:00:00.000Z",
      },
      message: "CloudShare is still resuming your lab. Wait a few seconds, then retry Resume exam.",
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "/api/exam/status?examAttemptId=attempt-1",
      { cache: "no-store" },
    );
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

  it("posts End exam to the completion API and returns completed when cleanup succeeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: "completed",
        examAttemptId: "attempt-1",
      }),
    });

    const result = await endLabAttempt(fetchImpl, "attempt-1");

    expect(fetchImpl).toHaveBeenCalledWith("/api/exam/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ examAttemptId: "attempt-1" }),
    });
    expect(result).toEqual({
      kind: "completed",
      message: "Examination complete.",
    });
  });

  it("refreshes authoritative status when End exam cleanup is pending", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({
          status: "pending",
          operation: "complete",
          retryable: true,
          environmentArchived: true,
          message: "CloudShare is still stopping your lab. Wait a few seconds, then retry End exam.",
        }),
      })
      .mockResolvedValueOnce({
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

    const result = await endLabAttempt(fetchImpl, "attempt-1");

    expect(result).toEqual({
      kind: "pending",
      environmentArchived: true,
      labStatus: {
        examAttemptId: "attempt-1",
        examTitle: "Helios Guided Journey",
        timeLimitMinutes: 60,
        status: "in_progress",
        scheduledFor: "2026-06-18T09:00:00.000Z",
      },
      message: "CloudShare is still archiving your lab. Wait a few seconds, then retry End exam.",
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

  it("maps unauthorized lab status responses to candidate-facing session-expired copy", async () => {
    await expect(
      loadCandidateLabStatus(
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          json: async () => ({ error: "unauthorized" }),
        }),
        "attempt-1",
      ),
    ).rejects.toThrow(
      "Your portal session has expired. Log in again to continue.",
    );
  });

  it("reads an authoritative suspended attempt status from heartbeat responses", () => {
    expect(readHeartbeatAttemptStatus({ attemptStatus: "suspended" })).toBe("suspended");
    expect(readHeartbeatAttemptStatus({ attemptStatus: "completed" })).toBe("completed");
    expect(readHeartbeatAttemptStatus({ attemptStatus: "in_progress" })).toBe("in_progress");
    expect(readHeartbeatAttemptStatus({ attemptStatus: "ready" })).toBeNull();
    expect(readHeartbeatAttemptStatus({ status: "ok" })).toBeNull();
  });
});
