export function formatCandidateScheduledDateTime(scheduledFor: string | null): string | null {
  return formatLocalDateTimeMinute(scheduledFor);
}

export function formatLocalDateTimeMinute(value: string | null): string | null {
  return formatLocalDateTime(value, { includeSeconds: false });
}

export function formatLocalDateTimeSecond(value: string | null): string | null {
  return formatLocalDateTime(value, { includeSeconds: true });
}

function formatLocalDateTime(
  scheduledFor: string | null,
  options: { readonly includeSeconds: boolean },
): string | null {
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
  const seconds = padDatePart(date.getSeconds());

  return options.includeSeconds
    ? `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
    : `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function formatCandidateScheduledForLabel(scheduledFor: string | null): string | null {
  const formatted = formatCandidateScheduledDateTime(scheduledFor);
  return formatted ? `Scheduled for ${formatted}` : null;
}

function padDatePart(value: number): string {
  return value.toString().padStart(2, "0");
}
