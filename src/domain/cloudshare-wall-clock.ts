const cloudShareTimeZones: Record<string, string> = {
  UTC: "UTC",
  "Eastern Standard Time": "America/New_York",
  "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles",
};

/** Converts CloudShare's timezone-less ISO wall-clock values without silently
 * applying the browser's local timezone. Ambiguous and skipped DST wall times
 * are deliberately rejected: a Sales Admin must choose an unambiguous window. */
export function addCloudShareWallClockMinutes(value: string, timeZone: string, minutes: number): string | null {
  const instant = cloudShareWallClockToInstant(value, timeZone);
  return instant === null ? null : formatCloudShareWallClock(new Date(instant.getTime() + minutes * 60_000), timeZone);
}

export function isValidCloudShareWallClock(value: string, timeZone: string): boolean {
  return cloudShareWallClockToInstant(value, timeZone) !== null;
}

export function cloudShareWallClockToInstant(value: string, timeZone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !resolveTimeZone(timeZone)) return null;
  const desiredMs = Date.parse(`${value}:00Z`);
  const matches: Date[] = [];
  // A bounded scan makes DST ambiguity explicit without relying on the host's
  // timezone. All supported zones have offsets inside this window.
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const candidate = new Date(desiredMs - offsetMinutes * 60_000);
    if (formatCloudShareWallClock(candidate, timeZone) === value) matches.push(candidate);
  }
  return matches.length === 1 ? matches[0] : null;
}

export function formatCloudShareWallClock(value: Date, timeZone: string): string | null {
  const resolved = resolveTimeZone(timeZone);
  if (!resolved) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: resolved, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const [year, month, day, hour, minute] = [get("year"), get("month"), get("day"), get("hour"), get("minute")];
  return year && month && day && hour && minute ? `${year}-${month}-${day}T${hour}:${minute}` : null;
}

function resolveTimeZone(value: string): string | null {
  // CloudShare's documented catalogue is the authority for selectable IDs. An
  // ID can already be an IANA value, while Windows IDs need only this narrow
  // rendering bridge on Node/ICU; callers never synthesize a timezone list.
  try { new Intl.DateTimeFormat("en-CA", { timeZone: value }).format(); return value; }
  catch {
    const resolved = cloudShareTimeZones[value];
    if (!resolved) return null;
    try { new Intl.DateTimeFormat("en-CA", { timeZone: resolved }).format(); return resolved; } catch { return null; }
  }
}
