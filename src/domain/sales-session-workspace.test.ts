import { describe, expect, it } from "vitest";
import { projectSafeSalesParticipantAttention, projectSafeSalesParticipantEnvironment, projectSafeSalesSessionActivity } from "./sales-session-workspace";

describe("safe Sales Session Activity projection", () => {
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
    ["participant.environment_observed", "Participant Environment observed."],
    ["participant.reconciled", "Participant reconciled."],
    ["participant_properties.ensured", "Participant properties confirmed."],
    ["participant_correlation.backfilled", "Participant correlation backfilled."],
  ])("projects %s through controlled human copy", (operation, summary) => {
    const entry = projectSafeSalesSessionActivity({ occurredAt: new Date("2026-07-24T09:00:00Z"), operation, outcome: "success", actorType: "admin", subjectType: "sales_demo_session", subjectId: "session-1", correlationId: null }, "session-1");
    expect(entry?.summary).toBe(summary);
  });

  it("keeps a roster reference without an observation distinct from no Environment assignment", () => {
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
