import type { Logger } from "@/observability/logger";

/**
 * Tracks periodic client heartbeats for active lab sessions and auto-suspends
 * the environment (plus pauses the exam timer) when heartbeats stop arriving.
 *
 * Design: the caller is responsible for calling recordHeartbeat on each inbound
 * /api/heartbeat request. The internal interval calls checkAll every
 * checkIntervalMs. If any tracked attempt has not received a heartbeat within
 * timeoutMs it is removed from tracking and suspendFn is invoked.
 */

export interface HeartbeatAutoSuspendDeps {
  /** Called when a heartbeat timeout is detected for an exam attempt. */
  readonly suspendFn: (examAttemptId: string) => Promise<void>;
  readonly logger: Logger;
  readonly timeoutMs: number;
  readonly checkIntervalMs?: number;
  /** Inject for deterministic unit tests; defaults to Date.now. */
  readonly getNow?: () => number;
}

export interface CheckAllOptions {
  /** Override getNow for a single checkAll call (useful in tests). */
  readonly getNow?: () => number;
}

export interface HeartbeatAutoSuspend {
  recordHeartbeat(examAttemptId: string): void;
  removeHeartbeat(examAttemptId: string): void;
  start(): void;
  stop(): void;
  checkAll(opts?: CheckAllOptions): Promise<void>;
}

export function createHeartbeatAutoSuspend(
  deps: HeartbeatAutoSuspendDeps,
): HeartbeatAutoSuspend {
  const timeoutMs = deps.timeoutMs;
  const checkIntervalMs = deps.checkIntervalMs ?? 10_000;
  const defaultGetNow = deps.getNow ?? (() => Date.now());
  const lastHeartbeat = new Map<string, number>();
  let timer: ReturnType<typeof setInterval> | null = null;

  function recordHeartbeat(examAttemptId: string): void {
    lastHeartbeat.set(examAttemptId, defaultGetNow());
  }

  function removeHeartbeat(examAttemptId: string): void {
    lastHeartbeat.delete(examAttemptId);
  }

  async function checkAll(opts?: CheckAllOptions): Promise<void> {
    const getNow = opts?.getNow ?? defaultGetNow;
    const now = getNow();
    const timedOut: string[] = [];
    for (const [examAttemptId, lastSeen] of lastHeartbeat) {
      if (now - lastSeen >= timeoutMs) {
        timedOut.push(examAttemptId);
      }
    }
    for (const examAttemptId of timedOut) {
      lastHeartbeat.delete(examAttemptId);
      try {
        await deps.suspendFn(examAttemptId);
        deps.logger.info("heartbeat timeout: auto-suspended environment", { examAttemptId });
      } catch (err) {
        deps.logger.warn("heartbeat timeout: auto-suspend failed", {
          examAttemptId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  function start(): void {
    if (timer !== null) return;
    timer = setInterval(() => void checkAll(), checkIntervalMs);
    (timer as NodeJS.Timeout).unref?.();
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { recordHeartbeat, removeHeartbeat, start, stop, checkAll };
}
