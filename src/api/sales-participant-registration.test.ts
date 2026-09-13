import { describe, expect, it, vi } from "vitest";
import { handleRegisterSalesParticipantWorkspace } from "./sales-participant-registration";
import type { SalesParticipantWorkspace } from "@/domain/sales-participant-workspace";

describe("participant registration handler", () => {
  const input = { customerId: "customer-1", sessionId: "session-1", actor: { type: "admin" as const, id: "admin-1", email: "admin@example.test" } };
  it.each([null, {}, { opportunityContactIds: [] }, { opportunityContactIds: ["contact-1", ""] }, { opportunityContactIds: ["contact-1", 1] }, { opportunityContactIds: ["contact-1", "contact-1"] }])("rejects malformed registration body %j before invoking the workspace", async (body) => {
    const workspace = { registerParticipants: vi.fn() } as unknown as SalesParticipantWorkspace;
    const result = await handleRegisterSalesParticipantWorkspace({ workspace }, { ...input, body });
    expect(result).toMatchObject({ status: 400 });
    expect(workspace.registerParticipants).not.toHaveBeenCalled();
  });
  it("delegates the Customer-scoped semantic request and returns its controlled result", async () => {
    const resultBody = { status: "registered", correlationId: "corr-1", registeredParticipantIds: ["participant-1"] };
    const registerParticipants = vi.fn().mockResolvedValue(resultBody);
    const workspace = { registerParticipants } as unknown as SalesParticipantWorkspace;
    await expect(handleRegisterSalesParticipantWorkspace({ workspace }, { ...input, body: { opportunityContactIds: ["contact-1"] } })).resolves.toBe(resultBody);
    expect(registerParticipants).toHaveBeenCalledWith({ ...input, opportunityContactIds: ["contact-1"] });
  });
});
