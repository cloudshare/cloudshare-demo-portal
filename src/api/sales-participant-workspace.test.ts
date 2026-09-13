import { describe, expect, it, vi } from "vitest";
import { handleReadSalesParticipantWorkspacePage } from "./sales-participant-workspace";
import type { SalesParticipantWorkspace } from "@/domain/sales-participant-workspace";
describe("participant page handler", () => {
  it("validates bounds and preserves Customer-scoped safe page", async () => {
    const workspace = { readPage: vi.fn().mockResolvedValue({ participants: [], total: 0, offset: 0, limit: 25, hasMore: false }), submitInvitation: vi.fn() } as unknown as SalesParticipantWorkspace;
    expect(await handleReadSalesParticipantWorkspacePage({ workspace }, { customerId: "c1", sessionId: "s1", offset: -1 })).toMatchObject({ status: 400 });
    expect(await handleReadSalesParticipantWorkspacePage({ workspace }, { customerId: "c1", sessionId: "s1", query: " Ada " })).toMatchObject({ status: 200 });
    expect(workspace.readPage).toHaveBeenCalledWith(expect.objectContaining({ customerId: "c1", sessionId: "s1", query: "Ada" }));
  });
  it("returns controlled not-found for cross-Customer or archived-equivalent reads", async () => {
    const workspace = { readPage: vi.fn().mockResolvedValue(null), submitInvitation: vi.fn() } as unknown as SalesParticipantWorkspace;
    expect(await handleReadSalesParticipantWorkspacePage({ workspace }, { customerId: "other", sessionId: "s1" })).toMatchObject({ status: 404 });
  });
  it("returns only ordinary DTO data and rejects oversized input", async () => {
    const workspace = { readPage: vi.fn().mockResolvedValue({ participants: [{ id: "p1", name: "Ada", email: "ada@example.test", participantRevision: "r", invitationStatus: "notSent", participationStatus: "pending", sessionEndsAt: "2026-12-01", nativeInvitationsEnabled: true, providerCorrelation: true, activeLaunchCapability: false, currentCommandId: null, invitationOutcome: null, launchOperation: null, environment: { value: null, source: "not_observed" }, environmentAttention: null }], total: 1, offset: 0, limit: 25, hasMore: false }), submitInvitation: vi.fn() } as unknown as SalesParticipantWorkspace;
    expect(await handleReadSalesParticipantWorkspacePage({ workspace }, { customerId: "c1", sessionId: "s1", query: "x".repeat(101) })).toMatchObject({ status: 400 });
    const result = await handleReadSalesParticipantWorkspacePage({ workspace }, { customerId: "c1", sessionId: "s1" });
    expect(JSON.stringify(result.body)).not.toMatch(/token|loginUrl|providerId|diagnostic|headers/i);
  });
});
