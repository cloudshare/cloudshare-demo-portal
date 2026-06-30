import { formatCandidateScheduledForLabel } from "./candidate-date-format";

export function getCandidateScorePresentation(input: {
  readonly examAttemptId: string;
  readonly examTitle: string;
  readonly scheduledFor: string | null;
}) {
  return {
    heading: input.examTitle,
    supportDetail: `Exam attempt: ${input.examAttemptId}`,
    scheduledForLabel: formatCandidateScheduledForLabel(input.scheduledFor),
  };
}
