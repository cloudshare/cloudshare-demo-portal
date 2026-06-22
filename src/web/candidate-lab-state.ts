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
  readonly scheduledFor: string | null;
}) {
  return {
    heading: input.examTitle,
    statusLabel: formatCandidateAttemptStatus(input.status),
    notice: null,
    showEnter: input.status === "ready" || input.status === "in_progress",
    showSuspend: input.status === "in_progress",
    showResume: input.status === "suspended",
    showCandidateHomeLink: true,
    showScoreLink: input.status === "completed",
    supportDetail: `Exam attempt: ${input.examAttemptId}`,
    scheduledForLabel: formatScheduledForLabel(input.scheduledFor),
    timeLimitLabel: `${input.timeLimitMinutes} minute limit`,
  };
}

function formatScheduledForLabel(scheduledFor: string | null): string | null {
  if (!scheduledFor) {
    return null;
  }

  const scheduledForDate = new Date(scheduledFor);
  if (Number.isNaN(scheduledForDate.getTime())) {
    return null;
  }

  return `Scheduled for ${scheduledForDate.toLocaleString()}`;
}
