import { describe, expect, it } from "vitest";
import { eligibleParticipantActions, participantActionReason, primaryParticipantAction, projectParticipantActionAvailability, pruneParticipantSelection, reduceParticipantSelection, validateParticipantPage, type SalesParticipantWorkspaceRow } from "./sales-participant-workspace";

const row: SalesParticipantWorkspaceRow = { id: "p1", participantRevision: "r1", name: "Ada", email: "ada@example.test", invitationStatus: "notSent", participationStatus: "pending", sessionEndsAt: "2026-09-12T12:00:00.000Z", nativeInvitationsEnabled: true, providerCorrelation: true, activeLaunchCapability: false, currentCommandId: null, invitationOutcome: null, launchOperation: null, environment: { dimension: "cloudshare_environment", value: null, source: "not_observed" }, environmentAttention: null, actionAvailability: {} as SalesParticipantWorkspaceRow["actionAvailability"], primaryAction: null };

describe("sales participant workspace contract", () => {
  it("keeps invitation and launch eligibility independent", () => {
    expect(eligibleParticipantActions(row, new Date("2026-09-12T11:00:00Z"))).toMatchObject({ invite: true, generate_launch: true, revoke_launch: false });
    expect(eligibleParticipantActions({ ...row, invitationStatus: "sent", activeLaunchCapability: true }, new Date("2026-09-12T13:00:00Z"))).toMatchObject({ resend: false, generate_launch: false, revoke_launch: true });
  });
  it("projects controlled availability and available_to_attempt into the server DTO", () => {
    const { actionAvailability, primaryAction } = projectParticipantActionAvailability(row, new Date("2026-09-12T11:00:00Z"));
    expect(actionAvailability.invite).toEqual({ available: true, reason: "available_to_attempt" });
    expect(actionAvailability.resend).toEqual({ available: false, reason: "invitation_not_sent" });
    expect(primaryAction).toBe("invite");
  });
  it("supports deterministic row navigation and additive selection", () => {
    let state: import("./sales-participant-workspace").ParticipantSelectionState = { activeId: null, selectedIds: [], rangeAnchorId: null };
    state = reduceParticipantSelection(state, { type: "click", id: "p1" });
    state = reduceParticipantSelection(state, { type: "click", id: "p2", additive: true });
    state = reduceParticipantSelection(state, { type: "click", id: "p3", range: true, pageIds: ["p1", "p2", "p3"] });
    state = reduceParticipantSelection(state, { type: "move", direction: "next", pageIds: ["p1", "p2", "p3"] });
    expect(state).toMatchObject({ activeId: "p3", selectedIds: ["p1", "p2", "p3"], rangeAnchorId: "p1" });
  });
  it("starts a new range anchor on a later plain click", () => {
    const selected = reduceParticipantSelection(
      { activeId: "p3", selectedIds: ["p1", "p2", "p3"], rangeAnchorId: "p1" },
      { type: "click", id: "p2", pageIds: ["p1", "p2", "p3"] },
    );
    expect(selected).toEqual({ activeId: "p2", selectedIds: ["p2"], rangeAnchorId: "p2" });
    expect(reduceParticipantSelection(selected, { type: "click", id: "p3", range: true, pageIds: ["p1", "p2", "p3"] }))
      .toEqual({ activeId: "p3", selectedIds: ["p2", "p3"], rangeAnchorId: "p2" });
  });
  it("bounds and trims page reads", () => {
    expect(validateParticipantPage({ query: "  Ada ", offset: 25, limit: 25 })).toEqual({ query: "Ada", offset: 25, limit: 25 });
    expect(validateParticipantPage({ offset: -1 })).toBeNull();
    expect(validateParticipantPage({ limit: 51 })).toBeNull();
  });
  it("does not treat nested controls as selection events", () => {
    const state = { activeId: "p1", selectedIds: ["p1"], rangeAnchorId: "p1" };
    expect(reduceParticipantSelection(state, { type: "nested_control", id: "p1", control: "button" })).toBe(state);
    expect(reduceParticipantSelection(state, { type: "nested_control", id: "p1", control: "input" })).toBe(state);
  });
  it("prunes selection and anchor when the visible page changes", () => {
    expect(pruneParticipantSelection({ activeId: "p2", selectedIds: ["p1", "p2", "gone"], rangeAnchorId: "gone" }, ["p1", "p2"]))
      .toEqual({ activeId: "p2", selectedIds: ["p1", "p2"], rangeAnchorId: null });
    expect(pruneParticipantSelection({ activeId: "gone", selectedIds: ["gone"], rangeAnchorId: "gone" }, ["p1"]))
      .toEqual({ activeId: "p1", selectedIds: [], rangeAnchorId: null });
  });
  it("explains unavailable primary actions from the current row", () => {
    expect(participantActionReason({ ...row, participationStatus: "concluded" }, "invite", new Date("2026-09-12T11:00:00Z"))).toBe("Participant has concluded.");
    expect(participantActionReason({ ...row, invitationStatus: "sent" }, "invite", new Date("2026-09-12T11:00:00Z"))).toBe("Invitation already sent; choose resend.");
    expect(participantActionReason(row, "invite", new Date("2026-09-12T13:00:00Z"))).toBe("Session access window has ended.");
  });
  it("honours the durable invitation fence without suppressing launch", () => {
    const fenced = { ...row, currentCommandId: "command-1" };
    expect(eligibleParticipantActions(fenced, new Date("2026-09-12T11:00:00Z"))).toMatchObject({ invite: false, generate_launch: true });
    expect(participantActionReason(fenced, "invite", new Date("2026-09-12T11:00:00Z"))).toContain("already in progress");
  });
  it("chooses exactly one primary action using the accepted precedence", () => {
    const now = new Date("2026-09-12T11:00:00Z");
    expect(primaryParticipantAction(row, now)).toBe("invite");
    expect(primaryParticipantAction({ ...row, invitationStatus: "sent" }, now)).toBe("generate_launch");
    expect(primaryParticipantAction({ ...row, invitationStatus: "sent", participationStatus: "concluded" }, now)).toBe("open_diagnostics");
  });
});
