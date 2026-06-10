import type { Logger } from "@/observability/logger";
import type { HeartbeatAutoSuspend } from "@/domain/heartbeat-auto-suspend";

/**
 * Framework-agnostic handler for the client heartbeat endpoint.
 *
 * The client POSTs while a lab is open; the server records the timestamp so
 * the HeartbeatAutoSuspend service can detect when heartbeats stop and
 * auto-suspend the environment.
 *
 * HTTP contract:
 *  - 400  missing/invalid examAttemptId
 *  - 200  heartbeat recorded
 */

export interface HeartbeatHandlerDeps {
  readonly autoSuspend: HeartbeatAutoSuspend;
  readonly logger: Logger;
}

export interface HeartbeatRequest {
  readonly body: unknown;
}

export interface HeartbeatResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export async function handleHeartbeat(
  deps: HeartbeatHandlerDeps,
  request: HeartbeatRequest,
): Promise<HeartbeatResponse> {
  const examAttemptId = extractExamAttemptId(request.body);
  if (!examAttemptId) {
    return { status: 400, body: { error: "examAttemptId is required" } };
  }

  deps.autoSuspend.recordHeartbeat(examAttemptId);
  deps.logger.debug("heartbeat received", { examAttemptId });
  return { status: 200, body: { status: "ok" } };
}

function extractExamAttemptId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { examAttemptId } = body as { examAttemptId?: unknown };
  return typeof examAttemptId === "string" && examAttemptId.trim().length > 0
    ? examAttemptId.trim()
    : null;
}
