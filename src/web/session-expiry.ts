export const PORTAL_SESSION_EXPIRED_MESSAGE =
  "Your session has expired. Sign in again to continue.";

export const PORTAL_SESSION_WATCHDOG_INTERVAL_MS = 30_000;

export type PortalSessionState = "active" | "expired" | "unknown";

interface SessionResponse {
  readonly status: number;
  readonly json?: () => Promise<unknown>;
}

interface PortalSessionObservation {
  readonly state: PortalSessionState;
  readonly deadlineDelayMs: number | null;
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
  readonly isDocumentVisible?: () => boolean;
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
  return (await observePortalSession(fetchImpl)).state;
}

async function observePortalSession(fetchImpl: FetchLike): Promise<PortalSessionObservation> {
  try {
    const response = await fetchImpl("/api/auth/session", {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (isPortalSessionExpiredStatus(response.status)) {
      return { state: "expired", deadlineDelayMs: null };
    }
    if (response.status !== 200 || !response.json) {
      return { state: response.status === 200 ? "active" : "unknown", deadlineDelayMs: null };
    }

    const body: unknown = await response.json();
    const session = typeof body === "object" && body !== null
      ? (body as { session?: unknown }).session
      : null;
    const expiresAtMs = typeof session === "object" && session !== null
      ? (session as { expiresAtMs?: unknown }).expiresAtMs
      : null;
    const serverNowMs = typeof body === "object" && body !== null
      ? (body as { serverNowMs?: unknown }).serverNowMs
      : null;
    return {
      state: "active",
      deadlineDelayMs: typeof expiresAtMs === "number" && typeof serverNowMs === "number"
        ? Math.max(0, expiresAtMs - serverNowMs)
        : null,
    };
  } catch {
    return { state: "unknown", deadlineDelayMs: null };
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
  addEventListenerFn = (type, listener) => {
    if (type === "visibilitychange" && typeof document !== "undefined") document.addEventListener(type, listener);
    else if (typeof window !== "undefined") window.addEventListener(type, listener);
  },
  removeEventListenerFn = (type, listener) => {
    if (type === "visibilitychange" && typeof document !== "undefined") document.removeEventListener(type, listener);
    else if (typeof window !== "undefined") window.removeEventListener(type, listener);
  },
  isDocumentVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden",
}: PortalSessionWatchdogOptions): {
  readonly checkNow: () => Promise<void>;
  readonly stop: () => void;
} {
  let stopped = false;
  let observedExpiredSession = false;
  let intervalHandle: TimerHandle | null = null;
  let deadlineHandle: TimeoutHandle | null = null;
  let inFlight: Promise<void> | null = null;
  const visibilityResumeCheck = () => {
    if (!stopped && isDocumentVisible()) {
      void checkNow();
    }
  };
  const focusResumeCheck = () => { if (!stopped) void checkNow(); };

  function stop(): void {
    if (stopped) {
      return;
    }
    stopped = true;
    if (intervalHandle !== null) {
      clearIntervalFn(intervalHandle);
    }
    if (deadlineHandle !== null) clearTimeoutFn(deadlineHandle);
    removeEventListenerFn("visibilitychange", visibilityResumeCheck);
    removeEventListenerFn("focus", focusResumeCheck);
  }

  async function checkNow(): Promise<void> {
    if (stopped || observedExpiredSession) {
      return;
    }

    if (inFlight) return inFlight;
    inFlight = (async () => {
      const observation = await observePortalSession(fetchImpl);
      if (stopped || observedExpiredSession) return;
      if (observation.state === "expired") {
        observedExpiredSession = true;
        stop();
        onExpired();
        return;
      }
      if (observation.deadlineDelayMs !== null) {
        if (deadlineHandle !== null) clearTimeoutFn(deadlineHandle);
        deadlineHandle = setTimeoutFn(() => { void checkNow(); }, observation.deadlineDelayMs);
      }
    })();
    await inFlight;
    inFlight = null;
    return;
  }

  intervalHandle = setIntervalFn(() => {
    void checkNow();
  }, intervalMs);
  addEventListenerFn("visibilitychange", visibilityResumeCheck);
  addEventListenerFn("focus", focusResumeCheck);

  return { checkNow, stop };
}
