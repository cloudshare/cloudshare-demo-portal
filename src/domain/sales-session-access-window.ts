import { cloudShareWallClockToInstant } from "./cloudshare-wall-clock";

export type SalesSessionAccessWindow = {
  readonly dimension: "certalis_session_access_window";
  readonly value: "before_window" | "open" | "closed" | "indeterminate";
  readonly source: "schedule_calculation";
  readonly nativeInvitationsAvailable: boolean;
};

export function projectSalesSessionAccessWindow(
  session: { readonly start: string; readonly end: string; readonly timeZone: string },
  now: Date,
): SalesSessionAccessWindow {
  const start = cloudShareWallClockToInstant(session.start, session.timeZone);
  const end = cloudShareWallClockToInstant(session.end, session.timeZone);
  const value = !start || !end ? "indeterminate" as const : end <= now ? "closed" as const : start > now ? "before_window" as const : "open" as const;
  return { dimension: "certalis_session_access_window", value, source: "schedule_calculation", nativeInvitationsAvailable: value === "before_window" || value === "open" };
}
