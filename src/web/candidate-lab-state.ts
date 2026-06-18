import type { CandidateDashboardData } from "./candidate-scheduling";

export function formatCandidateAttemptStatus(
  status: CandidateDashboardData["attempts"][number]["status"],
): string {
  switch (status) {
    case "in_progress":
      return "In progress";
    case "completed":
      return "Completed";
    case "suspended":
      return "Suspended";
    case "ready":
      return "Ready";
    case "scheduled":
      return "Scheduled";
    case "expired":
      return "Expired";
    default:
      return status;
  }
}

export function getCandidateLabPresentation(input: {
  readonly status: CandidateDashboardData["attempts"][number]["status"];
  readonly examAttemptId: string;
  readonly examTitle: string;
  readonly timeLimitMinutes: number;
}) {
  return {
    heading: input.examTitle,
    statusLabel: formatCandidateAttemptStatus(input.status),
    notice: input.status === "completed" ? "Examination complete." : null,
    showEnter: input.status === "ready" || input.status === "in_progress",
    showSuspend: input.status === "in_progress",
    showResume: input.status === "suspended",
    showCandidateHomeLink: true,
    showScoreLink: input.status === "completed",
    supportDetail: `Exam attempt: ${input.examAttemptId}`,
    timeLimitLabel: `${input.timeLimitMinutes} minute limit`,
  };
}
