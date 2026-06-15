import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHeartbeatAutoSuspend } from "./heartbeat-auto-suspend";
import type { Logger } from "@/observability/logger";

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("HeartbeatAutoSuspend", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records a heartbeat for an exam attempt", async () => {
    const suspendFn = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();
    const now = Date.now();
    const service = createHeartbeatAutoSuspend({
      suspendFn,
      logger,
      timeoutMs: 60_000,
      getNow: () => now,
    });

    service.recordHeartbeat("attempt-1");
    // advance to just under timeout — should not suspend
    await service.checkAll({ getNow: () => now + 59_999 });

    expect(suspendFn).not.toHaveBeenCalled();
  });

  it("auto-suspends and removes tracking when timeout is exceeded", async () => {
    const suspendFn = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();
    const now = Date.now();
    const service = createHeartbeatAutoSuspend({
      suspendFn,
      logger,
      timeoutMs: 60_000,
      getNow: () => now,
    });

    service.recordHeartbeat("attempt-1");
    await service.checkAll({ getNow: () => now + 60_000 });

    expect(suspendFn).toHaveBeenCalledOnce();
    expect(suspendFn).toHaveBeenCalledWith("attempt-1");

    // second check — already removed, should not suspend again
    await service.checkAll({ getNow: () => now + 120_000 });
    expect(suspendFn).toHaveBeenCalledOnce();
  });

  it("logs a warning and continues if suspendFn throws", async () => {
    const error = new Error("cloudshare unavailable");
    const suspendFn = vi.fn().mockRejectedValue(error);
    const logger = makeLogger();
    const now = Date.now();
    const service = createHeartbeatAutoSuspend({
      suspendFn,
      logger,
      timeoutMs: 30_000,
      getNow: () => now,
    });

    service.recordHeartbeat("attempt-x");
    await service.checkAll({ getNow: () => now + 30_000 });

    expect(suspendFn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledOnce();
    const [msg, fields] = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(msg).toContain("auto-suspend failed");
    expect(fields).toMatchObject({ examAttemptId: "attempt-x" });
  });

  it("keeps tracking a timed-out attempt when auto-suspend fails so the next check retries", async () => {
    const suspendFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(undefined);
    const logger = makeLogger();
    const now = Date.now();
    const service = createHeartbeatAutoSuspend({
      suspendFn,
      logger,
      timeoutMs: 30_000,
      getNow: () => now,
    });

    service.recordHeartbeat("attempt-retry");
    await service.checkAll({ getNow: () => now + 30_000 });
    await service.checkAll({ getNow: () => now + 60_000 });

    expect(suspendFn).toHaveBeenCalledTimes(2);
    expect(suspendFn).toHaveBeenNthCalledWith(1, "attempt-retry");
    expect(suspendFn).toHaveBeenNthCalledWith(2, "attempt-retry");
  });

  it("handles multiple attempts independently", async () => {
    const suspendFn = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();
    const base = Date.now();
    let fakeNow = base;
    const service = createHeartbeatAutoSuspend({
      suspendFn,
      logger,
      timeoutMs: 60_000,
      getNow: () => fakeNow,
    });

    service.recordHeartbeat("attempt-a");
    fakeNow = base + 30_000;
    service.recordHeartbeat("attempt-b");

    // At base+60000: attempt-a timed out, attempt-b still has 30s left
    await service.checkAll({ getNow: () => base + 60_000 });
    expect(suspendFn).toHaveBeenCalledOnce();
    expect(suspendFn).toHaveBeenCalledWith("attempt-a");

    // At base+90000: attempt-b also timed out
    await service.checkAll({ getNow: () => base + 90_001 });
    expect(suspendFn).toHaveBeenCalledTimes(2);
    expect(suspendFn).toHaveBeenCalledWith("attempt-b");
  });

  it("removeHeartbeat stops tracking an attempt", async () => {
    const suspendFn = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();
    const now = Date.now();
    const service = createHeartbeatAutoSuspend({
      suspendFn,
      logger,
      timeoutMs: 60_000,
      getNow: () => now,
    });

    service.recordHeartbeat("attempt-1");
    service.removeHeartbeat("attempt-1");

    await service.checkAll({ getNow: () => now + 120_000 });
    expect(suspendFn).not.toHaveBeenCalled();
  });

  it("refreshing a heartbeat resets the timeout window", async () => {
    const suspendFn = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();
    const base = Date.now();
    let fakeNow = base;
    const service = createHeartbeatAutoSuspend({
      suspendFn,
      logger,
      timeoutMs: 60_000,
      getNow: () => fakeNow,
    });

    service.recordHeartbeat("attempt-1");
    fakeNow = base + 50_000;
    service.recordHeartbeat("attempt-1"); // refresh

    // would have been 60s from base, but now 60s from base+50000
    await service.checkAll({ getNow: () => base + 60_000 });
    expect(suspendFn).not.toHaveBeenCalled();

    await service.checkAll({ getNow: () => base + 110_001 });
    expect(suspendFn).toHaveBeenCalledOnce();
  });

  it("reset() clears all tracked entries so no phantom suspension fires after reset", async () => {
    const suspendFn = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();
    const base = Date.now();
    const service = createHeartbeatAutoSuspend({
      suspendFn,
      logger,
      timeoutMs: 60_000,
      getNow: () => base,
    });

    service.recordHeartbeat("attempt-1");
    service.recordHeartbeat("attempt-2");

    // Reset before the timeout — stale entries should be gone
    service.reset();

    await service.checkAll({ getNow: () => base + 120_000 });
    expect(suspendFn).not.toHaveBeenCalled();
  });

  it("start/stop wires the interval and prevents further checks", async () => {
    const suspendFn = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();
    const base = Date.now();
    const service = createHeartbeatAutoSuspend({
      suspendFn,
      logger,
      timeoutMs: 60_000,
      checkIntervalMs: 10_000,
    });

    service.recordHeartbeat("attempt-1");
    service.start();
    service.stop();

    // Advance timers — the fake clock advances Date.now() by 200 s, which would
    // exceed the 60 s timeout if the interval was still running. But stop() cleared
    // it, so the interval never fires and suspendFn is never called.
    vi.advanceTimersByTime(200_000);
    expect(suspendFn).not.toHaveBeenCalled();
  });
});
