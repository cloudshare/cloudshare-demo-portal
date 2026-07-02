export const PORTAL_SESSION_EXPIRED_MESSAGE =
  "Your session has expired. Sign in again to continue.";

export const PORTAL_SESSION_WATCHDOG_INTERVAL_MS = 30_000;

export type PortalSessionState = "active" | "expired" | "unknown";

interface SessionResponse {
  readonly status: number;
}

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<SessionResponse>;

type TimerHandle = ReturnType<typeof setInterval>;

interface PortalSessionWatchdogOptions {
  readonly fetchImpl: FetchLike;
  readonly onExpired: () => void;
  readonly intervalMs?: number;
  readonly setIntervalFn?: (
    callback: () => void,
    delayMs: number,
  ) => TimerHandle;
  readonly clearIntervalFn?: (handle: TimerHandle) => void;
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
}: PortalSessionWatchdogOptions): {
  readonly checkNow: () => Promise<void>;
  readonly stop: () => void;
} {
  let stopped = false;
  let observedExpiredSession = false;
  let intervalHandle: TimerHandle | null = null;

  function stop(): void {
    if (stopped) {
      return;
    }
    stopped = true;
    if (intervalHandle !== null) {
      clearIntervalFn(intervalHandle);
    }
  }

  async function checkNow(): Promise<void> {
    if (stopped || observedExpiredSession) {
      return;
    }

    const sessionState = await checkPortalSession(fetchImpl);
    if (stopped || observedExpiredSession) {
      return;
    }

    if (sessionState !== "expired") {
      return;
    }

    observedExpiredSession = true;
    stop();
    onExpired();
  }

  intervalHandle = setIntervalFn(() => {
    void checkNow();
  }, intervalMs);

  return { checkNow, stop };
}
