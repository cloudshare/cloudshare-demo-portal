import {
  getCandidateLabStatusRuntime,
  type ExamAttemptHeartbeatStatusDeps,
  type ExamAttemptHeartbeatStatusResponse,
} from "./exam-attempt-heartbeat-status-runtime";

export type CandidateLabStatusDeps = ExamAttemptHeartbeatStatusDeps;
export interface CandidateLabStatusServices {
  readonly examAttempts: CandidateLabStatusDeps["attempts"];
  readonly exams: CandidateLabStatusDeps["exams"];
  readonly examClock: CandidateLabStatusDeps["clocks"];
  readonly diagnosticRecorder: CandidateLabStatusDeps["diagnostics"];
  readonly logger: CandidateLabStatusDeps["logger"];
}

export type CandidateLabStatusResponse = ExamAttemptHeartbeatStatusResponse;

export function buildCandidateLabStatusDeps(
  services: CandidateLabStatusServices,
): CandidateLabStatusDeps {
  return {
    attempts: services.examAttempts,
    exams: services.exams,
    clocks: services.examClock,
    diagnostics: services.diagnosticRecorder,
    logger: services.logger,
  };
}

export async function handleGetCandidateLabStatus(
  deps: CandidateLabStatusDeps,
  request: {
    readonly examAttemptId: string;
    readonly candidateId: string;
  },
): Promise<CandidateLabStatusResponse> {
  return getCandidateLabStatusRuntime(deps, request);
}
