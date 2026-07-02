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
});
