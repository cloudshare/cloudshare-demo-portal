export const PORTAL_SESSION_EXPIRED_MESSAGE =
  "Your session has expired. Sign in again to continue.";

export const PORTAL_SESSION_WATCHDOG_INTERVAL_MS = 30_000;

export type PortalSessionState = "active" | "expired" | "unknown";

interface SessionResponse {
  readonly status: number;
  readonly json?: () => Promise<unknown>;
}

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<SessionResponse>;

type TimerHandle = ReturnType<typeof setInterval>;
type TimeoutHandle = ReturnType<typeof setTimeout>;

interface PortalSessionWatchdogOptions {
  readonly fetchImpl: FetchLike;
  readonly onExpired: () => void;
  readonly intervalMs?: number;
  readonly setIntervalFn?: (
    callback: () => void,
    delayMs: number,
  ) => TimerHandle;
  readonly clearIntervalFn?: (handle: TimerHandle) => void;
  readonly setTimeoutFn?: (callback: () => void, delayMs: number) => TimeoutHandle;
  readonly clearTimeoutFn?: (handle: TimeoutHandle) => void;
  readonly addEventListenerFn?: (type: string, listener: () => void) => void;
  readonly removeEventListenerFn?: (type: string, listener: () => void) => void;
}

export class PortalSessionExpiredError extends Error {
  constructor(message = PORTAL_SESSION_EXPIRED_MESSAGE) {
    super(message);
    this.name = "PortalSessionExpiredError";
  }
}

export function isPortalSessionExpiredStatus(status: number): boolean {
  return status === 401;
}

export function isPortalSessionExpiredError(
  error: unknown,
): error is PortalSessionExpiredError {
  return error instanceof PortalSessionExpiredError;
}

export async function checkPortalSession(
  fetchImpl: FetchLike,
): Promise<PortalSessionState> {
  try {
    const response = await fetchImpl("/api/auth/session", {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    return isPortalSessionExpiredStatus(response.status) ? "expired" : "active";
  } catch {
    return "unknown";
  }
}

export function startPortalSessionWatchdog({
  fetchImpl,
  onExpired,
  intervalMs = PORTAL_SESSION_WATCHDOG_INTERVAL_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  addEventListenerFn = (type, listener) => { if (typeof window !== "undefined") window.addEventListener(type, listener); },
  removeEventListenerFn = (type, listener) => { if (typeof window !== "undefined") window.removeEventListener(type, listener); },
}: PortalSessionWatchdogOptions): {
  readonly checkNow: () => Promise<void>;
  readonly stop: () => void;
} {
  let stopped = false;
  let observedExpiredSession = false;
  let intervalHandle: TimerHandle | null = null;
  let deadlineHandle: TimeoutHandle | null = null;
  let inFlight: Promise<void> | null = null;

  function stop(): void {
    if (stopped) {
      return;
    }
    stopped = true;
    if (intervalHandle !== null) {
      clearIntervalFn(intervalHandle);
    }
    if (deadlineHandle !== null) clearTimeoutFn(deadlineHandle);
    removeEventListenerFn("visibilitychange", resumeCheck);
    removeEventListenerFn("focus", resumeCheck);
  }

  async function checkNow(): Promise<void> {
    if (stopped || observedExpiredSession) {
      return;
    }

    if (inFlight) return inFlight;
    inFlight = (async () => {
    let response: SessionResponse;
    try { response = await fetchImpl("/api/auth/session", { cache: "no-store", headers: { accept: "application/json" } }); }
    catch { return; }
    if (stopped || observedExpiredSession) return;
    if (response.status === 401) { observedExpiredSession = true; stop(); onExpired(); return; }
    if (response.status !== 200) return;
    let body: any;
    try { body = response.json ? await response.json() : null; } catch { return; }
    const expiresAt = body?.session?.expiresAtMs;
    const serverNow = body?.serverNowMs;
    if (typeof expiresAt === "number" && typeof serverNow === "number") {
      const delay = Math.max(0, expiresAt - serverNow);
      if (deadlineHandle !== null) clearTimeoutFn(deadlineHandle);
      deadlineHandle = setTimeoutFn(() => { void checkNow(); }, delay);
    }
    })();
    await inFlight;
    inFlight = null;
    return;
  }

  intervalHandle = setIntervalFn(() => {
    void checkNow();
  }, intervalMs);
  const resumeCheck = () => { if (!stopped && typeof document !== "undefined" && document.visibilityState !== "hidden") void checkNow(); };
  addEventListenerFn("visibilitychange", resumeCheck);
  addEventListenerFn("focus", resumeCheck);

  return { checkNow, stop };
}
