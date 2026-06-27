import type { Logger } from "@/observability/logger";
import type { HeartbeatAutoSuspend } from "@/domain/heartbeat-auto-suspend";
import type { LabLaunch } from "@/domain/lab-launch";
import {
  recordExamAttemptHeartbeatRuntime,
  type ExamAttemptHeartbeatStatusResponse,
  type ManualHeartbeatRuntimeDeps,
} from "./exam-attempt-heartbeat-status-runtime";

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

export interface ExamAttemptHeartbeatDepsOptions {
  readonly candidateEmail?: string;
}

export interface ExamAttemptHeartbeatServices {
  readonly examAttempts: ManualHeartbeatRuntimeDeps["attempts"];
  readonly exams: ManualHeartbeatRuntimeDeps["exams"];
  readonly examClock: ManualHeartbeatRuntimeDeps["clocks"];
  readonly heartbeatAutoSuspend: ManualHeartbeatRuntimeDeps["autoSuspend"];
  readonly diagnosticRecorder: ManualHeartbeatRuntimeDeps["diagnostics"];
  readonly logger: ManualHeartbeatRuntimeDeps["logger"];
  readonly environmentSource: ManualHeartbeatRuntimeDeps["environmentSource"];
  readonly cloudshareConnections: ManualHeartbeatRuntimeDeps["connections"];
  readonly cloudshareClientFactory: ManualHeartbeatRuntimeDeps["cloudshare"];
}

export interface HeartbeatResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export function buildExamAttemptHeartbeatDeps(
  services: ExamAttemptHeartbeatServices,
  options: ExamAttemptHeartbeatDepsOptions = {},
): ManualHeartbeatRuntimeDeps {
  return {
    attempts: services.examAttempts,
    exams: services.exams,
    clocks: services.examClock,
    autoSuspend: services.heartbeatAutoSuspend,
    diagnostics: services.diagnosticRecorder,
    logger: services.logger,
    candidateEmail: options.candidateEmail,
    environmentSource: services.environmentSource,
    connections: services.cloudshareConnections,
    cloudshare: services.cloudshareClientFactory,
  };
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

export async function handleExamAttemptHeartbeat(
  deps: ManualHeartbeatRuntimeDeps,
  request: {
    readonly examAttemptId: string;
    readonly candidateId: string;
    readonly launch: LabLaunch | null;
  },
): Promise<ExamAttemptHeartbeatStatusResponse> {
  return recordExamAttemptHeartbeatRuntime(deps, request);
}

function extractExamAttemptId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { examAttemptId } = body as { examAttemptId?: unknown };
  return typeof examAttemptId === "string" && examAttemptId.trim().length > 0
    ? examAttemptId.trim()
    : null;
}
