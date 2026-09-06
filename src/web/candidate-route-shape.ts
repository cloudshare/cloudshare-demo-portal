export function isValidCandidateRouteShape(input: {
  readonly task: string | null;
  readonly hasAttemptId: boolean;
  readonly hasExamId: boolean;
}): boolean {
  if (!input.task || !["current", "schedule", "history"].includes(input.task)) return false;
  if (input.task === "schedule" && input.hasAttemptId) return false;
  if (input.task !== "schedule" && input.hasExamId && !input.hasAttemptId) return false;
  return true;
}
