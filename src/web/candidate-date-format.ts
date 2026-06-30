export function formatCandidateScheduledDateTime(scheduledFor: string | null): string | null {
  if (!scheduledFor) {
    return null;
  }

  const date = new Date(scheduledFor);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  const hours = padDatePart(date.getHours());
  const minutes = padDatePart(date.getMinutes());

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function formatCandidateScheduledForLabel(scheduledFor: string | null): string | null {
  const formatted = formatCandidateScheduledDateTime(scheduledFor);
  return formatted ? `Scheduled for ${formatted}` : null;
}

function padDatePart(value: number): string {
  return value.toString().padStart(2, "0");
}
