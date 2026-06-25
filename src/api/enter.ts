import {
  enterExamAttemptRuntime,
  type EnterExamAttemptRuntimeRequest,
  type ExamAttemptRuntimeDeps,
} from "./exam-attempt-runtime";

export type EnterExamDeps = ExamAttemptRuntimeDeps;
export type EnterExamRequest = EnterExamAttemptRuntimeRequest;

export interface EnterExamResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

const inFlightEnterRequests = new Map<string, Promise<EnterExamResponse>>();

export async function handleEnterExam(
  deps: EnterExamDeps,
  request: EnterExamRequest,
): Promise<EnterExamResponse> {
  const requestKey = buildEnterRequestKey(request);
  const existing = inFlightEnterRequests.get(requestKey);
  if (existing) {
    return existing;
  }

  const pending = handleEnterExamOnce(deps, request).finally(() => {
    if (inFlightEnterRequests.get(requestKey) === pending) {
      inFlightEnterRequests.delete(requestKey);
    }
  });
  inFlightEnterRequests.set(requestKey, pending);
  return pending;
}

async function handleEnterExamOnce(
  deps: EnterExamDeps,
  request: EnterExamRequest,
): Promise<EnterExamResponse> {
  const result = await enterExamAttemptRuntime(deps, request);

  if (result.kind === "redirect") {
    return {
      status: 302,
      headers: {
        location: result.location,
        "cache-control": "no-store",
      },
      body: result.body,
    };
  }

  return textResponse(result.status, result.body.message);
}

function textResponse(status: number, body: string): EnterExamResponse {
  return {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
    body,
  };
}

function buildEnterRequestKey(request: EnterExamRequest): string {
  return `${request.candidateId}:${request.examAttemptId}`;
}
