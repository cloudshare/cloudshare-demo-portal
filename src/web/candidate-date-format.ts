export function formatCandidateScheduledDateTime(scheduledFor: string | null): string | null {
  if (!scheduledFor) {
    return null;
  }

  const date = new Date(scheduledFor);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC`;
}

export function formatCandidateScheduledForLabel(scheduledFor: string | null): string | null {
  const formatted = formatCandidateScheduledDateTime(scheduledFor);
  return formatted ? `Scheduled for ${formatted}` : null;
}
