import { describe, expect, it } from "vitest";
import { projectSalesSessionAccessWindow } from "./sales-session-access-window";

describe("Sales Session access window", () => {
  it("closes local access immediately when cancellation is admitted even while provider cleanup is pending", () => {
    const session = { start: "2026-07-19T08:00", end: "2026-07-19T10:00", timeZone: "UTC", cancellationRequestedAt: new Date("2026-07-19T09:00:00Z") };
    expect(projectSalesSessionAccessWindow(session, new Date("2026-07-19T09:00:00Z"))).toMatchObject({ value: "closed", nativeInvitationsAvailable: false });
  });
  it("projects invitation access from the schedule without inventing a provider lifecycle", () => {
    const before = projectSalesSessionAccessWindow({ start: "2026-07-20T09:00", end: "2026-07-20T10:00", timeZone: "UTC" }, new Date("2026-07-19T09:00:00Z"));
    const open = projectSalesSessionAccessWindow({ start: "2026-07-19T08:00", end: "2026-07-19T10:00", timeZone: "UTC" }, new Date("2026-07-19T09:00:00Z"));
    const closed = projectSalesSessionAccessWindow({ start: "2026-07-19T07:00", end: "2026-07-19T08:00", timeZone: "UTC" }, new Date("2026-07-19T09:00:00Z"));

    expect(before).toEqual({ dimension: "certalis_session_access_window", value: "before_window", source: "schedule_calculation", nativeInvitationsAvailable: true });
    expect(open).toEqual({ dimension: "certalis_session_access_window", value: "open", source: "schedule_calculation", nativeInvitationsAvailable: true });
    expect(closed).toEqual({ dimension: "certalis_session_access_window", value: "closed", source: "schedule_calculation", nativeInvitationsAvailable: false });
    expect(JSON.stringify([before, open, closed])).not.toContain("lifecycle");
  });

  it("fails closed when the schedule cannot be resolved", () => {
    expect(projectSalesSessionAccessWindow({ start: "invalid", end: "invalid", timeZone: "UTC" }, new Date("2026-07-19T09:00:00Z"))).toEqual({ dimension: "certalis_session_access_window", value: "indeterminate", source: "schedule_calculation", nativeInvitationsAvailable: false });
  });
});
