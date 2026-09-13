import { describe, expect, it, vi } from "vitest";
import { handleReadSalesParticipantWorkspacePage } from "./sales-participant-workspace";
import { handleAddSalesParticipantWorkspace, handleReconcileSalesParticipantWorkspace } from "./sales-participant-registration";
import type { SalesParticipantWorkspace } from "@/domain/sales-participant-workspace";
describe("participant page handler", () => {
  it("normalizes a valid add request and rejects malformed input at the API seam", async () => {
    const addParticipant = vi.fn().mockResolvedValue({ status: 201, body: { outcome: "registered" } });
    const workspace = { addParticipant } as unknown as SalesParticipantWorkspace;
    const commandId = "47ec2e7a-0e34-4ca6-9dd0-4e88ef8f2320";
    await expect(handleAddSalesParticipantWorkspace({ workspace }, { customerId: "c1", sessionId: "s1", actor: { type: "admin", id: "a", email: "a@test" }, body: { commandId: ` ${commandId} `, person: { kind: "existingContact", contactId: " contact-1 " } } })).resolves.toMatchObject({ status: 201 });
    expect(addParticipant).toHaveBeenCalledWith(expect.objectContaining({ commandId, person: { kind: "existingContact", contactId: "contact-1" } }));
    await expect(handleAddSalesParticipantWorkspace({ workspace }, { customerId: "c1", sessionId: "s1", actor: { type: "admin", id: "a", email: "a@test" }, body: { commandId: "cmd-2", person: { kind: "adHoc", firstName: "", lastName: "B", email: "b@test" } } })).resolves.toMatchObject({ status: 400 });
  });
  it("validates and forwards a read-only participant status check by durable command identity", async () => {
    const commandId = "11111111-1111-4111-8111-111111111111";
    const reconcileParticipantAdd = vi.fn().mockResolvedValue({ status: 503, body: { outcome: "rejected", code: "participant_add_retryable" } });
    const workspace = { reconcileParticipantAdd } as unknown as SalesParticipantWorkspace;
    await expect(handleReconcileSalesParticipantWorkspace({ workspace }, { customerId: "c1", sessionId: "s1", actor: { type: "admin" }, body: { commandId } })).resolves.toMatchObject({ status: 503 });
    expect(reconcileParticipantAdd).toHaveBeenCalledWith({ customerId: "c1", sessionId: "s1", actor: { type: "admin" }, commandId });
  });
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
