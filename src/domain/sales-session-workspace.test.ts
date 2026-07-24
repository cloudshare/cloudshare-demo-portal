import { describe, expect, it } from "vitest";
import { projectSafeSalesParticipantAttention, projectSafeSalesParticipantEnvironment, projectSafeSalesSessionActivity } from "./sales-session-workspace";

describe("safe Sales Session Activity projection", () => {
  it("creates controlled operational copy without accepting raw diagnostic message or protected evidence", () => {
    const entry = projectSafeSalesSessionActivity({ occurredAt: new Date("2026-07-24T09:00:00Z"), operation: "sales.demo_session.created", outcome: "failure", actorType: "admin", subjectType: "sales_demo_session", subjectId: "session-1", correlationId: "corr-1" }, "session-1");
    const serialized = JSON.stringify({ entry, message: undefined, request: undefined, response: undefined });
    expect(entry).toEqual(expect.objectContaining({ summary: "Sales Session provision failed.", actor: { type: "admin" }, subject: { type: "sales_demo_session", id: "session-1" } }));
    expect(serialized).not.toMatch(/loginUrl|bearer|authorization|api[_-]?key|token|envId|provider/i);
  });

  it("fails closed when a diagnostic is not anchored to this Sales Session", () => {
    expect(projectSafeSalesSessionActivity({ occurredAt: new Date(), operation: "sales.demo_session.created", outcome: "success", actorType: "admin", subjectType: "sales_demo_session", subjectId: "other-session", correlationId: "corr" }, "session-1")).toBeNull();
  });

  it("omits an unknown diagnostic outcome instead of presenting it as success", () => {
    expect(projectSafeSalesSessionActivity({ occurredAt: new Date(), operation: "sales.demo_session.created", outcome: "partial", actorType: "admin", subjectType: "sales_demo_session", subjectId: "session-1", correlationId: "corr" }, "session-1")).toBeNull();
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
