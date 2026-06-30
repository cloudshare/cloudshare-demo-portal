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

export function parseCandidateLocalDateTimeInput(input: string): string | null {
  const match = input.trim().match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (month < 1 || month > 12 || hour > 23 || minute > 59) {
    return null;
  }

  const date = new Date(year, month - 1, day, hour, minute);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }

  return date.toISOString();
}

function padDatePart(value: number): string {
  return value.toString().padStart(2, "0");
}
