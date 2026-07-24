import { describe, expect, it, vi } from "vitest";
import { handleReadSalesSessionWorkspace } from "./sales-session-workspace";

const workspace = {
  summary: {
    id: "session-1", sessionName: "Acme enablement", revision: 3,
    start: "2026-07-24T09:00:00.000Z", end: "2026-07-24T10:00:00.000Z", timeZone: "Europe/London",
    operation: { value: "correlated", source: "certalis_persistence" },
    experience: { value: "notStarted", source: "schedule_prediction", freshness: "estimated" },
  },
  participants: [{ id: "participant-1", name: "Ada Lovelace", email: "ada@example.test", invitationStatus: "sent", participationStatus: "pending" }],
  activity: [{ occurredAt: "2026-07-23T09:00:00.000Z", operation: "sales.demo_session.created", outcome: "success", message: "Sales Session provisioned", actor: { type: "admin", email: "sales@example.test" }, subject: { type: "sales_demo_session", id: "session-1" }, correlationId: "corr-1" }],
  details: { accountName: "Acme", opportunityName: "Evaluation", itemName: "Enablement item", invitationMode: "Sales Pros and participants" },
};

describe("Sales Session workspace handler", () => {
  it("returns one Customer-scoped local workspace with metadata-only Activity", async () => {
    const read = vi.fn().mockResolvedValue(workspace);
    const result = await handleReadSalesSessionWorkspace({ workspace: { read } }, { customerId: "customer-a", sessionId: "session-1" });

    expect(read).toHaveBeenCalledWith("customer-a", "session-1");
    expect(result).toMatchObject({ status: 200, body: { summary: { revision: 3, experience: { freshness: "estimated" } }, participants: [{ name: "Ada Lovelace" }], activity: [{ correlationId: "corr-1" }] } });
    expect(JSON.stringify(result.body)).not.toMatch(/loginUrl|bearer|api[_-]?key|authorization|responseJson|requestJson/i);
  });

  it("fails closed for absent, archived, stale, or cross-Customer targets", async () => {
    const read = vi.fn().mockResolvedValue(null);
    const result = await handleReadSalesSessionWorkspace({ workspace: { read } }, { customerId: "customer-a", sessionId: "customer-b-session" });

    expect(result).toEqual({ status: 404, body: { error: "This Sales Session is unavailable for this Customer." } });
    expect(read).toHaveBeenCalledWith("customer-a", "customer-b-session");
  });
});
