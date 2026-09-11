import { describe, expect, it } from "vitest";
import { groupSafeSalesSessionActivity, projectSafeSalesParticipantAttention, projectSafeSalesParticipantEnvironment, projectSafeSalesSessionActivity } from "./sales-session-workspace";

describe("safe Sales Session Activity projection", () => {
  const activity = (kind: string, correlationId: string | null, outcome: "success" | "failure", at: string, id = `${kind}-${at}`) => ({ activityId: id, occurredAt: at, kind: kind as never, summary: `${kind} ${outcome}`, outcome, actor: { type: "system" as const }, subject: { type: "sales_demo_session" as const, id: "session-1" }, ...(correlationId ? { correlationId } : {}) });

  it("collapses minimized creation plus OAuth evidence into one provision workflow", () => {
    const groups = groupSafeSalesSessionActivity([activity("unknown", "corr", "success", "2026-07-24T09:00:00.000Z"), activity("session_provision", "corr", "success", "2026-07-24T09:00:01.000Z")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ outcome: "success", count: 2 });
  });

  it("collapses the complete #431 transport sequence into one provision workflow", () => {
    const children = Array.from({ length: 12 }, (_, index) => activity(index === 11 ? "session_provision" : "unknown", "corr", "success", `2026-07-24T09:00:${String(index).padStart(2, "0")}.000Z`, `row-${index}`));
    expect(groupSafeSalesSessionActivity(children)).toHaveLength(1);
  });

  it("groups realistic participant registration and reconciliation traces by terminal meaning", () => {
    const registration = [
      activity("unknown", "register", "success", "2026-07-24T09:00:00.000Z"),
      activity("participant_properties_ensured", "register", "success", "2026-07-24T09:00:01.000Z"),
      activity("participant_correlation_backfilled", "register", "success", "2026-07-24T09:00:02.000Z"),
      activity("participants_registered", "register", "success", "2026-07-24T09:00:03.000Z"),
    ];
    const reconciliation = [
      activity("unknown", "reconcile", "success", "2026-07-24T09:01:00.000Z"),
      activity("participant_environment_observed", "reconcile", "success", "2026-07-24T09:01:01.000Z"),
      activity("participant_reconciled", "reconcile", "success", "2026-07-24T09:01:02.000Z"),
      activity("participants_reconciled", "reconcile", "success", "2026-07-24T09:01:03.000Z"),
    ];
    expect(groupSafeSalesSessionActivity([...registration, ...reconciliation])).toEqual(expect.arrayContaining([
      expect.objectContaining({ correlationId: "register", count: 4, outcome: "success" }),
      expect.objectContaining({ correlationId: "reconcile", count: 4, outcome: "success" }),
    ]));
  });

  it("keeps same-kind correlations separate and orders tied timestamps by persisted id", () => {
    const groups = groupSafeSalesSessionActivity([activity("session_provision", "b", "success", "2026-07-24T09:00:00.000Z", "b-id"), activity("session_provision", "a", "success", "2026-07-24T09:00:00.000Z", "a-id"), activity("session_provision", null, "failure", "2026-07-24T09:00:00.000Z", "legacy-2"), activity("session_provision", null, "success", "2026-07-24T09:00:00.000Z", "legacy-1")]);
    expect(groups).toHaveLength(4);
    expect(groups.map((group) => group.correlationId)).toEqual([undefined, "a", "b", undefined]);
  });

  it("keeps two known business operations distinct and makes an unknown child incomplete", () => {
    const groups = groupSafeSalesSessionActivity([activity("session_provision", "corr", "success", "2026-07-24T09:00:02.000Z"), activity("session_reconciliation", "corr", "success", "2026-07-24T09:00:03.000Z"), activity("unknown", "corr", "success", "2026-07-24T09:00:04.000Z")]);
    expect(groups).toHaveLength(3);
    expect(groups.find((group) => group.count === 1 && group.outcome === "incomplete")).toBeTruthy();
  });

  it.each([
    ["terminal failure plus successful child", [activity("unknown", "corr", "failure", "2026-07-24T09:00:00.000Z"), activity("session_provision", "corr", "failure", "2026-07-24T09:00:01.000Z")], "failure"],
    ["successful child before terminal failure", [activity("session_provision", "corr", "failure", "2026-07-24T09:00:01.000Z"), activity("unknown", "corr", "success", "2026-07-24T09:00:00.000Z")], "failure"],
    ["terminal failure after successful child", [activity("unknown", "corr", "success", "2026-07-24T09:00:00.000Z"), activity("session_provision", "corr", "failure", "2026-07-24T09:00:01.000Z")], "failure"],
    ["terminal success plus failed child", [activity("unknown", "corr", "failure", "2026-07-24T09:00:00.000Z"), activity("session_provision", "corr", "success", "2026-07-24T09:00:01.000Z")], "mixed"],
    ["child-only correlation", [activity("unknown", "corr", "success", "2026-07-24T09:00:00.000Z")], "incomplete"],
  ] as const)("reports %s truthfully", (_name, entries, outcome) => expect(groupSafeSalesSessionActivity(entries)[0]?.outcome).toBe(outcome));

  it("keeps every same-correlation child kind in one incomplete workflow", () => {
    const groups = groupSafeSalesSessionActivity([
      activity("unknown", "child-only", "success", "2026-07-24T09:00:00.000Z"),
      activity("participant_properties_ensured", "child-only", "failure", "2026-07-24T09:00:01.000Z"),
      activity("participant_environment_observed", "child-only", "success", "2026-07-24T09:00:02.000Z"),
      activity("participant_reconciled", "child-only", "failure", "2026-07-24T09:00:03.000Z"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ count: 4, outcome: "incomplete", summary: "Business outcome and evidence are incomplete." });
  });

  it("retains standalone failed legacy activity and never leaks protected-looking inputs", () => {
    const entry = projectSafeSalesSessionActivity({ id: "legacy-1", occurredAt: new Date("2026-07-24T09:00:00Z"), operation: "bearer.token.loginUrl", outcome: "failure", actorType: "system", subjectType: "sales_demo_session", subjectId: "session-1", correlationId: null }, "session-1")!;
    expect(groupSafeSalesSessionActivity([entry])).toMatchObject([{ outcome: "failure", count: 1 }]);
    expect(JSON.stringify(entry)).not.toMatch(/bearer|loginUrl|token/i);
  });
  it("keeps independent correlations and legacy rows separate while marking mixed outcomes", () => {
    const base = { occurredAt: new Date("2026-07-24T09:00:00Z"), operation: "sales.demo_session.created", actorType: "admin", subjectType: "sales_demo_session", subjectId: "session-1" };
    const rows = [
      projectSafeSalesSessionActivity({ ...base, outcome: "success", correlationId: "a" }, "session-1")!,
      projectSafeSalesSessionActivity({ ...base, occurredAt: new Date("2026-07-24T09:01:00Z"), outcome: "failure", correlationId: "a" }, "session-1")!,
      projectSafeSalesSessionActivity({ ...base, occurredAt: new Date("2026-07-24T09:02:00Z"), outcome: "success", correlationId: "b" }, "session-1")!,
      projectSafeSalesSessionActivity({ ...base, occurredAt: new Date("2026-07-24T09:03:00Z"), outcome: "success", correlationId: null }, "session-1")!,
    ];
    const groups = groupSafeSalesSessionActivity(rows);
    expect(groups).toHaveLength(3);
    expect(groups.find((group) => group.diagnosticRecords.some((record) => record.correlationId === "a"))?.outcome).toBe("failure");
    expect(groups.filter((group) => group.diagnosticRecords.length === 0)).toHaveLength(1);
  });
  it("creates controlled operational copy without accepting raw diagnostic message or protected evidence", () => {
    const entry = projectSafeSalesSessionActivity({ occurredAt: new Date("2026-07-24T09:00:00Z"), operation: "sales.demo_session.created", outcome: "failure", actorType: "admin", subjectType: "sales_demo_session", subjectId: "session-1", correlationId: "corr-1" }, "session-1");
    const serialized = JSON.stringify({ entry, message: undefined, request: undefined, response: undefined });
    expect(entry).toEqual(expect.objectContaining({ kind: "session_provision", summary: "Sales Session provision failed.", actor: { type: "admin" }, subject: { type: "sales_demo_session", id: "session-1" } }));
    expect(serialized).not.toMatch(/loginUrl|bearer|authorization|api[_-]?key|token|envId|provider/i);
  });

  it("fails closed when a diagnostic is not anchored to this Sales Session", () => {
    expect(projectSafeSalesSessionActivity({ occurredAt: new Date(), operation: "sales.demo_session.created", outcome: "success", actorType: "admin", subjectType: "sales_demo_session", subjectId: "other-session", correlationId: "corr" }, "session-1")).toBeNull();
  });

  it("keeps known Participant operations distinct for safe Activity grouping", () => {
    const base = { occurredAt: new Date("2026-07-24T09:00:00Z"), outcome: "success", actorType: "admin", subjectType: "sales_demo_session", subjectId: "session-1", correlationId: null };
    expect(projectSafeSalesSessionActivity({ ...base, operation: "sales.demo_session.participants.registered" }, "session-1")?.summary).toBe("Sales Participants registered.");
    expect(projectSafeSalesSessionActivity({ ...base, operation: "sales.demo_session.participants.invited" }, "session-1")?.summary).toBe("Sales Participant invitations sent.");
    expect(projectSafeSalesSessionActivity({ ...base, operation: "sales.demo_session.participants.reconciled" }, "session-1")?.summary).toBe("Sales Participants reconciled.");
    expect(projectSafeSalesSessionActivity({ ...base, operation: "sales.demo_session.participants.registered", outcome: "failure" }, "session-1")?.summary).toBe("Sales Participant registration failed.");
    expect(projectSafeSalesSessionActivity({ ...base, operation: "sales.demo_session.participants.invited", outcome: "failure" }, "session-1")?.summary).toBe("Sales Participant invitations failed.");
    expect(projectSafeSalesSessionActivity({ ...base, operation: "sales.demo_session.participants.reconciled", outcome: "failure" }, "session-1")?.summary).toBe("Sales Participant reconciliation failed.");
    expect(projectSafeSalesSessionActivity({ ...base, operation: "sales.demo_session.participants.unsafe_unknown" }, "session-1")?.summary).toBe("Sales Participant operation completed.");
  });

  it("omits an unknown diagnostic outcome instead of presenting it as success", () => {
    expect(projectSafeSalesSessionActivity({ occurredAt: new Date(), operation: "sales.demo_session.created", outcome: "partial", actorType: "admin", subjectType: "sales_demo_session", subjectId: "session-1", correlationId: "corr" }, "session-1")).toBeNull();
  });

  it("uses human-readable safe copy for an unknown Session operation", () => {
    const entry = projectSafeSalesSessionActivity({
      occurredAt: new Date("2026-07-24T09:00:00Z"),
      operation: "provider.bearer_secret.operation",
      outcome: "success",
      actorType: "system",
      subjectType: "sales_demo_session",
      subjectId: "session-1",
      correlationId: null,
    }, "session-1");
    expect(entry).toMatchObject({ kind: "unknown", summary: "Sales Session update completed." });
    expect(JSON.stringify(entry)).not.toContain("provider.bearer_secret.operation");
  });

  it.each([
    ["sales.demo_session.participant.environment_observed", "Participant Environment observed."],
    ["sales.demo_session.participant.reconciled", "Participant reconciled."],
    ["sales.demo_session.participant_properties.ensured", "Participant properties confirmed."],
    ["sales.demo_session.participant_correlation.backfilled", "Participant correlation backfilled."],
  ])("projects %s through controlled human copy", (operation, summary) => {
    const entry = projectSafeSalesSessionActivity({ occurredAt: new Date("2026-07-24T09:00:00Z"), operation, outcome: "success", actorType: "admin", subjectType: "sales_demo_session", subjectId: "session-1", correlationId: null }, "session-1");
    expect(entry?.summary).toBe(summary);
  });

  it("keeps a roster reference without an observation distinct from no Environment assignment", () => {
    expect(projectSafeSalesParticipantEnvironment({ cloudShareRosterEnvironmentReference: "server-only-reference", environmentStatus: null, environmentStatusCode: 2, environmentObservedAt: new Date("2026-07-19T09:00:00Z") })).toMatchObject({ value: "Ready", source: "cloudshare_v3_environment", observedAt: "2026-07-19T09:00:00.000Z" });
    expect(projectSafeSalesParticipantEnvironment({ cloudShareRosterEnvironmentReference: null, environmentStatus: null, environmentStatusCode: 2, environmentObservedAt: null })).toMatchObject({ value: null, source: "not_observed" });
    expect(projectSafeSalesParticipantEnvironment({ cloudShareRosterEnvironmentReference: "server-only-reference", environmentStatus: null, environmentStatusCode: null, environmentObservedAt: null })).toMatchObject({ source: "not_observed" });
    expect(projectSafeSalesParticipantEnvironment({ cloudShareRosterEnvironmentReference: null, environmentStatus: null, environmentStatusCode: null, environmentObservedAt: null })).toMatchObject({ source: "not_assigned" });
  });

  it("projects persisted Environment attention through controlled copy and fails unknown evidence closed", () => {
    expect(projectSafeSalesParticipantAttention({
      environmentAttentionReason: "environment_ambiguous_for_project",
      environmentAttentionSource: "cloudshare_v3_owner_email_item_project",
    })).toEqual({
      reason: "Multiple matching Participant Environments require support review.",
      source: "Certalis Environment correlation check",
    });
    expect(projectSafeSalesParticipantAttention({
      environmentAttentionReason: "environment_not_found_for_project",
      environmentAttentionSource: "cloudshare_v3_owner_email_item_project",
    })).toEqual({
      reason: "No matching Participant Environment was found; support review is required.",
      source: "Certalis Environment correlation check",
    });
    expect(projectSafeSalesParticipantAttention({
      environmentAttentionReason: "Bearer secret from provider response",
      environmentAttentionSource: "unsafe-provider-detail",
    })).toEqual({
      reason: "Participant Environment resolution requires support review.",
      source: "Certalis correlation",
    });
    expect(projectSafeSalesParticipantAttention({
      environmentAttentionReason: null,
      environmentAttentionSource: "cloudshare_v3_owner_email_item_project",
    })).toBeNull();
  });
});
