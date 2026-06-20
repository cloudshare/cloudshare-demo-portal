const TIMEZONE_LESS_UTC_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?$/;

export function parseUtcDateTimeInput(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const timezoneLessMatch = TIMEZONE_LESS_UTC_PATTERN.exec(trimmed);
  if (timezoneLessMatch) {
    const [, year, month, day, hour, minute, second = "00", fractional = ".000"] =
      timezoneLessMatch;
    const milliseconds = Number.parseInt(fractional.slice(1).padEnd(3, "0"), 10);
    return new Date(
      Date.UTC(
        Number.parseInt(year, 10),
        Number.parseInt(month, 10) - 1,
        Number.parseInt(day, 10),
        Number.parseInt(hour, 10),
        Number.parseInt(minute, 10),
        Number.parseInt(second, 10),
        milliseconds,
      ),
    );
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toUtcIsoString(value: string): string | null {
  const parsed = parseUtcDateTimeInput(value);
  return parsed ? parsed.toISOString() : null;
}
