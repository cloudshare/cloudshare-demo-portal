export const CANDIDATE_TASK_VIEWS = ["current", "schedule", "history"] as const;
export type CandidateTaskView = (typeof CANDIDATE_TASK_VIEWS)[number];

export function isCandidateTaskView(value: string | null | undefined): value is CandidateTaskView {
  return value !== null && value !== undefined && CANDIDATE_TASK_VIEWS.includes(value as CandidateTaskView);
}

export function isValidCandidateIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
}

export function isValidCandidateRouteShape(input: {
  readonly task: string | null;
  readonly hasAttemptId: boolean;
  readonly hasExamId: boolean;
}): boolean {
  if (!isCandidateTaskView(input.task)) return false;
  if (input.task === "schedule" && input.hasAttemptId) return false;
  if (input.task !== "schedule" && input.hasExamId && !input.hasAttemptId) return false;
  return true;
}
