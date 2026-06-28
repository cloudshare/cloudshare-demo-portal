import type { CandidateDashboardData } from "./candidate-scheduling";

export type CandidateLabSummaryItem = {
  label: string;
  value: string;
};

export type CandidateLabPresentation = {
  heading: string;
  statusLabel: string;
  notice: string | null;
  showEnter: boolean;
  showSuspend: boolean;
  showResume: boolean;
  showCandidateHomeLink: boolean;
  showScoreLink: boolean;
  supportDetail: string;
  scheduledForLabel: string | null;
  timeLimitLabel: string;
  summaryItems: CandidateLabSummaryItem[];
  actionTitle: string;
  actionDetail: string;
};

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
}): CandidateLabPresentation {
  const statusLabel = formatCandidateAttemptStatus(input.status);
  const scheduledForLabel = formatScheduledForLabel(input.scheduledFor);
  const timeLimitLabel = `${input.timeLimitMinutes} minute limit`;

  return {
    heading: input.examTitle,
    statusLabel,
    notice: null,
    showEnter: input.status === "ready" || input.status === "in_progress",
    showSuspend: input.status === "in_progress",
    showResume: input.status === "suspended",
    showCandidateHomeLink: true,
    showScoreLink: input.status === "completed",
    supportDetail: `Exam attempt: ${input.examAttemptId}`,
    scheduledForLabel,
    timeLimitLabel,
    summaryItems: buildCandidateLabSummaryItems({
      examAttemptId: input.examAttemptId,
      statusLabel,
      timeLimitLabel,
      scheduledForLabel,
    }),
    ...getCandidateLabActionCopy(input.status),
  };
}

function buildCandidateLabSummaryItems(input: {
  readonly examAttemptId: string;
  readonly statusLabel: string;
  readonly timeLimitLabel: string;
  readonly scheduledForLabel: string | null;
}): CandidateLabSummaryItem[] {
  const items: CandidateLabSummaryItem[] = [
    { label: "ExamAttempt ID", value: input.examAttemptId },
    { label: "Status", value: input.statusLabel },
    { label: "Time limit", value: input.timeLimitLabel },
  ];

  if (input.scheduledForLabel) {
    items.push({
      label: "Scheduled for",
      value: input.scheduledForLabel.replace(/^Scheduled for /, ""),
    });
  }

  return items;
}

function getCandidateLabActionCopy(
  status: CandidateDashboardData["attempts"][number]["status"],
): Pick<CandidateLabPresentation, "actionTitle" | "actionDetail"> {
  switch (status) {
    case "ready":
      return {
        actionTitle: "Ready to enter your exam",
        actionDetail: "Use Enter exam to open your CloudShare lab in a new window.",
      };
    case "in_progress":
      return {
        actionTitle: "Your exam is currently running",
        actionDetail:
          "Keep the lab window open while you work, or use Suspend lab before stepping away.",
      };
    case "suspended":
      return {
        actionTitle: "Your lab is paused",
        actionDetail: "Use Resume exam when you are ready to continue with the same ExamAttempt.",
      };
    case "completed":
      return {
        actionTitle: "This ExamAttempt is complete",
        actionDetail: "Your lab is no longer accepting launch or resume actions.",
      };
    default:
      return {
        actionTitle: "Review your exam status",
        actionDetail: "Refresh the page or return to Candidate Home if this attempt looks incorrect.",
      };
  }
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
