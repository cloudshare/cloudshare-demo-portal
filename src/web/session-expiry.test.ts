import { describe, expect, it, vi } from "vitest";
import {
  PORTAL_SESSION_EXPIRED_MESSAGE,
  PortalSessionExpiredError,
  checkPortalSession,
  isPortalSessionExpiredError,
  isPortalSessionExpiredStatus,
  startPortalSessionWatchdog,
} from "./session-expiry";

describe("portal session expiry helpers", () => {
  it("treats unauthorized responses as expired portal sessions", () => {
    expect(isPortalSessionExpiredStatus(401)).toBe(true);
    expect(isPortalSessionExpiredStatus(403)).toBe(false);
    expect(isPortalSessionExpiredStatus(500)).toBe(false);
  });

  it("marks portal session expiry errors with the user-facing session message", () => {
    const error = new PortalSessionExpiredError();

    expect(isPortalSessionExpiredError(error)).toBe(true);
    expect(error.message).toBe(PORTAL_SESSION_EXPIRED_MESSAGE);
  });

  it("checks the shared auth session endpoint without exposing API error text", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 401,
    });

    await expect(checkPortalSession(fetchImpl)).resolves.toBe("expired");
    expect(fetchImpl).toHaveBeenCalledWith("/api/auth/session", {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  });

  it("stops the watchdog after the first expired session observation", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 401,
    });
    const onExpired = vi.fn();
    const clearIntervalFn = vi.fn();
    const setIntervalFn = vi.fn().mockReturnValue(123);

    const watchdog = startPortalSessionWatchdog({
      fetchImpl,
      onExpired,
      setIntervalFn,
      clearIntervalFn,
    });

    await watchdog.checkNow();
    await watchdog.checkNow();

    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(clearIntervalFn).toHaveBeenCalledWith(123);
  });

  it("does not report an expired session after the watchdog is stopped mid-check", async () => {
    let resolveSession!: (value: { status: number }) => void;
    const fetchImpl = vi.fn(
      () =>
        new Promise<{ status: number }>((resolve) => {
          resolveSession = resolve;
        }),
    );
    const onExpired = vi.fn();
    const clearIntervalFn = vi.fn();
    const setIntervalFn = vi.fn().mockReturnValue(123);

    const watchdog = startPortalSessionWatchdog({
      fetchImpl,
      onExpired,
      setIntervalFn,
      clearIntervalFn,
    });
    const pendingCheck = watchdog.checkNow();

    watchdog.stop();
    resolveSession({ status: 401 });
    await pendingCheck;

    expect(onExpired).not.toHaveBeenCalled();
    expect(clearIntervalFn).toHaveBeenCalledWith(123);
  });

  it("schedules a server-deadline check and coalesces concurrent validation", async () => {
    vi.useFakeTimers();
    const setTimeoutFn = vi.fn().mockReturnValue(456);
    const clearTimeoutFn = vi.fn();
    let resolve!: (value: { status: number; json: () => Promise<unknown> }) => void;
    const fetchImpl = vi.fn(() => new Promise<{ status: number; json: () => Promise<unknown> }>(r => { resolve = r; }));
    const watchdog = startPortalSessionWatchdog({ fetchImpl, onExpired: vi.fn(), setIntervalFn: vi.fn().mockReturnValue(1), clearIntervalFn: vi.fn(), setTimeoutFn, clearTimeoutFn });
    const first = watchdog.checkNow();
    const second = watchdog.checkNow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    resolve({ status: 200, json: async () => ({ serverNowMs: 1_000, session: { expiresAtMs: 2_000 } }) });
    await Promise.all([first, second]);
    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 1_000);
    watchdog.stop();
    expect(clearTimeoutFn).toHaveBeenCalledWith(456);
    vi.useRealTimers();
  });

  it("removes an idle rendered session when its server deadline validation expires", async () => {
    const onExpired = vi.fn();
    const deadlineCallbacks: Array<() => void> = [];
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({ serverNowMs: 10_000, session: { expiresAtMs: 10_500 } }),
      })
      .mockResolvedValueOnce({ status: 401 });
    const watchdog = startPortalSessionWatchdog({
      fetchImpl,
      onExpired,
      setIntervalFn: vi.fn().mockReturnValue(1),
      clearIntervalFn: vi.fn(),
      setTimeoutFn: (callback) => { deadlineCallbacks.push(callback); return 2 as unknown as ReturnType<typeof setTimeout>; },
      clearTimeoutFn: vi.fn(),
    });

    await watchdog.checkNow();
    expect(deadlineCallbacks).toHaveLength(1);
    deadlineCallbacks[0]!();
    await vi.waitFor(() => expect(onExpired).toHaveBeenCalledTimes(1));
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    deadlineCallbacks[0]!();
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("revalidates once on focus or visible resume and removes its listeners on stop", async () => {
    const listeners = new Map<string, () => void>();
    const removeEventListenerFn = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue({ status: 200 });
    let visible = false;
    const watchdog = startPortalSessionWatchdog({
      fetchImpl,
      onExpired: vi.fn(),
      setIntervalFn: vi.fn().mockReturnValue(1),
      clearIntervalFn: vi.fn(),
      addEventListenerFn: (type, listener) => { listeners.set(type, listener); },
      removeEventListenerFn,
      isDocumentVisible: () => visible,
    });

    listeners.get("visibilitychange")!();
    expect(fetchImpl).not.toHaveBeenCalled();

    listeners.get("focus")!();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    visible = true;
    listeners.get("visibilitychange")!();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    watchdog.stop();

    expect(removeEventListenerFn).toHaveBeenCalledWith("focus", listeners.get("focus"));
    expect(removeEventListenerFn).toHaveBeenCalledWith("visibilitychange", listeners.get("visibilitychange"));
  });
});
