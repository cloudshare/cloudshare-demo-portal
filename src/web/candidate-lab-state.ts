import type { CandidateDashboardData } from "./candidate-scheduling";
import { formatCandidateScheduledForLabel } from "./candidate-date-format";

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

export function isCandidateLabHistoryPresentation(
  status: CandidateDashboardData["attempts"][number]["status"],
  openPeriodClosed = false,
): boolean {
  return status === "completed" || status === "expired" || (openPeriodClosed && (status === "in_progress" || status === "suspended"));
}

export function getCandidateLabPresentation(input: {
  readonly status: CandidateDashboardData["attempts"][number]["status"];
  readonly examAttemptId: string;
  readonly examTitle: string;
  readonly timeLimitMinutes: number;
  readonly scheduledFor: string | null;
  readonly openPeriodEndsAt?: string | null;
  readonly openPeriodClosed?: boolean;
}): CandidateLabPresentation {
  const statusLabel = formatCandidateAttemptStatus(input.status);
  const scheduledForLabel = formatCandidateScheduledForLabel(input.scheduledFor);
  const timeLimitLabel = `${input.timeLimitMinutes} minute limit`;
  const openPeriodEndsAtLabel = input.openPeriodEndsAt ? formatCandidateScheduledForLabel(input.openPeriodEndsAt) : null;
  const openPeriodClosed = input.openPeriodClosed === true;

  return {
    heading: input.examTitle,
    statusLabel,
    notice: openPeriodClosed ? "This Exam open period has closed." : null,
    showEnter: !openPeriodClosed && (input.status === "ready" || input.status === "in_progress"),
    showSuspend: !openPeriodClosed && input.status === "in_progress",
    showResume: !openPeriodClosed && input.status === "suspended",
    showCandidateHomeLink: true,
    showScoreLink: isCandidateLabHistoryPresentation(input.status, openPeriodClosed),
    supportDetail: `Exam attempt: ${input.examAttemptId}`,
    scheduledForLabel,
    timeLimitLabel,
    summaryItems: buildCandidateLabSummaryItems({
      examAttemptId: input.examAttemptId,
      statusLabel,
      timeLimitLabel,
      scheduledForLabel,
      openPeriodEndsAtLabel,
    }),
    ...getCandidateLabActionCopy(input.status, openPeriodClosed),
  };
}

function buildCandidateLabSummaryItems(input: {
  readonly examAttemptId: string;
  readonly statusLabel: string;
  readonly timeLimitLabel: string;
  readonly scheduledForLabel: string | null;
  readonly openPeriodEndsAtLabel: string | null;
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

  if (input.openPeriodEndsAtLabel) {
    items.push({
      label: "Open until",
      value: input.openPeriodEndsAtLabel.replace(/^Scheduled for /, ""),
    });
  }

  return items;
}

function getCandidateLabActionCopy(
  status: CandidateDashboardData["attempts"][number]["status"],
  openPeriodClosed = false,
): Pick<CandidateLabPresentation, "actionTitle" | "actionDetail"> {
  if (openPeriodClosed) {
    return {
      actionTitle: "This Exam open period has closed",
      actionDetail: "Launch and resume actions are no longer available for this ExamAttempt.",
    };
  }

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

