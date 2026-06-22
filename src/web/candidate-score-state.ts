export function getCandidateScorePresentation(input: {
  readonly examAttemptId: string;
  readonly examTitle: string;
  readonly scheduledFor: string | null;
}) {
  return {
    heading: input.examTitle,
    supportDetail: `Exam attempt: ${input.examAttemptId}`,
    scheduledForLabel: formatScheduledForLabel(input.scheduledFor),
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
