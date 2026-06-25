import {
  getCandidateLabStatusRuntime,
  type ExamAttemptHeartbeatStatusDeps,
  type ExamAttemptHeartbeatStatusResponse,
} from "./exam-attempt-heartbeat-status-runtime";

export type CandidateLabStatusDeps = ExamAttemptHeartbeatStatusDeps;

export type CandidateLabStatusResponse = ExamAttemptHeartbeatStatusResponse;

export async function handleGetCandidateLabStatus(
  deps: CandidateLabStatusDeps,
  request: {
    readonly examAttemptId: string;
    readonly candidateId: string;
  },
): Promise<CandidateLabStatusResponse> {
  return getCandidateLabStatusRuntime(deps, request);
}
