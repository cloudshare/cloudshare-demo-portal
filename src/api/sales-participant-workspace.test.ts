import { describe, expect, it, vi } from "vitest";
import { handleReadSalesParticipantWorkspacePage } from "./sales-participant-workspace";
describe("participant page handler", () => {
  it("validates bounds and preserves Customer-scoped safe page", async () => {
    const reader = { readPage: vi.fn().mockResolvedValue({ participants: [], total: 0, offset: 0, limit: 25, hasMore: false }) };
    expect(await handleReadSalesParticipantWorkspacePage({ reader }, { customerId: "c1", sessionId: "s1", offset: -1 })).toMatchObject({ status: 400 });
    expect(await handleReadSalesParticipantWorkspacePage({ reader }, { customerId: "c1", sessionId: "s1", query: " Ada " })).toMatchObject({ status: 200 });
    expect(reader.readPage).toHaveBeenCalledWith(expect.objectContaining({ customerId: "c1", sessionId: "s1", query: "Ada" }));
  });
  it("returns controlled not-found for cross-Customer or archived-equivalent reads", async () => {
    const reader = { readPage: vi.fn().mockResolvedValue(null) };
    expect(await handleReadSalesParticipantWorkspacePage({ reader }, { customerId: "other", sessionId: "s1" })).toMatchObject({ status: 404 });
  });
  it("returns only ordinary DTO data and rejects oversized input", async () => {
    const reader = { readPage: vi.fn().mockResolvedValue({ participants: [{ id: "p1", name: "Ada", email: "ada@example.test", participantRevision: "r", invitationStatus: "notSent", participationStatus: "pending", sessionEndsAt: "2026-12-01", nativeInvitationsEnabled: true, providerCorrelation: true, activeLaunchCapability: false, currentCommandId: null, invitationOutcome: null, launchOperation: null, environment: { value: null, source: "not_observed" }, environmentAttention: null }], total: 1, offset: 0, limit: 25, hasMore: false }) };
    expect(await handleReadSalesParticipantWorkspacePage({ reader }, { customerId: "c1", sessionId: "s1", query: "x".repeat(101) })).toMatchObject({ status: 400 });
    const result = await handleReadSalesParticipantWorkspacePage({ reader }, { customerId: "c1", sessionId: "s1" });
    expect(JSON.stringify(result.body)).not.toMatch(/token|loginUrl|provider|diagnostic|headers/i);
  });
});
