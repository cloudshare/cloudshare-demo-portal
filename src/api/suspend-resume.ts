import {
  resumeExamAttemptRuntime,
  runHeartbeatAutoSuspendRuntime,
  suspendExamAttemptRuntime,
  type HeartbeatAutoSuspendHandlerDeps,
  type ResumeHandlerDeps,
  type SuspendHandlerDeps,
  type SuspendResumeResponse,
} from "./exam-attempt-suspend-resume-runtime";

export type {
  HeartbeatAutoSuspendHandlerDeps,
  ResumeHandlerDeps,
  SuspendHandlerDeps,
  SuspendResumeResponse,
} from "./exam-attempt-suspend-resume-runtime";

export interface SuspendResumeRequest {
  readonly body: unknown;
}

const inFlightTransitions = new Map<string, Promise<SuspendResumeResponse>>();

export async function handleSuspendExam(
  deps: SuspendHandlerDeps,
  request: SuspendResumeRequest,
): Promise<SuspendResumeResponse> {
  const examAttemptId = extractExamAttemptId(request.body);
  if (!examAttemptId) {
    return { status: 400, body: { error: "examAttemptId is required" } };
  }
  return coalesceTransition(`suspend:${examAttemptId}`, () =>
    suspendExamAttemptRuntime(deps, { examAttemptId }),
  );
}

export async function handleResumeExam(
  deps: ResumeHandlerDeps,
  request: SuspendResumeRequest,
): Promise<SuspendResumeResponse> {
  const examAttemptId = extractExamAttemptId(request.body);
  if (!examAttemptId) {
    return { status: 400, body: { error: "examAttemptId is required" } };
  }
  return coalesceTransition(`resume:${examAttemptId}`, () =>
    resumeExamAttemptRuntime(deps, { examAttemptId }),
  );
}

export function runHeartbeatAutoSuspend(
  deps: HeartbeatAutoSuspendHandlerDeps,
  examAttemptId: string,
): Promise<void> {
  return runHeartbeatAutoSuspendRuntime(deps, examAttemptId);
}

function extractExamAttemptId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { examAttemptId } = body as { examAttemptId?: unknown };
  return typeof examAttemptId === "string" && examAttemptId.trim().length > 0
    ? examAttemptId.trim()
    : null;
}

function coalesceTransition(
  key: string,
  factory: () => Promise<SuspendResumeResponse>,
): Promise<SuspendResumeResponse> {
  const existing = inFlightTransitions.get(key);
  if (existing) {
    return existing;
  }

  const pending = factory().finally(() => {
    if (inFlightTransitions.get(key) === pending) {
      inFlightTransitions.delete(key);
    }
  });
  inFlightTransitions.set(key, pending);
  return pending;
}
