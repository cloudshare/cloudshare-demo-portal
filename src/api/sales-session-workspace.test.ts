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
    const read = vi.fn().mockResolvedValue({ state: "available", workspace });
    const result = await handleReadSalesSessionWorkspace({ workspace: { read } }, { customerId: "customer-a", sessionId: "session-1" });

    expect(read).toHaveBeenCalledWith("customer-a", "session-1");
    expect(result).toMatchObject({ status: 200, body: { summary: { revision: 3, experience: { freshness: "estimated" } }, participants: [{ name: "Ada Lovelace" }], activity: [{ correlationId: "corr-1" }] } });
    expect(JSON.stringify(result.body)).not.toMatch(/loginUrl|bearer|api[_-]?key|authorization|responseJson|requestJson/i);
  });

  it("preserves retained ambiguous and later definite workflows as separate safe DTOs", async () => {
    const read = vi.fn().mockResolvedValue({ state: "available", workspace: { ...workspace, activityGroups: [
      { workflowId: "ambiguous", summary: "Business outcome and evidence are incomplete.", outcome: "incomplete", actor: "Sales admin", subject: "This Sales Session", firstAt: "2026-07-23T09:00:00.000Z", lastAt: "2026-07-23T09:01:00.000Z", count: 2, correlationId: "corr-ambiguous", steps: [{ label: "OAuth token acquired.", outcome: "success", occurredAt: "2026-07-23T09:00:00.000Z" }, { label: "Business outcome unknown.", outcome: "incomplete", occurredAt: "2026-07-23T09:01:00.000Z" }], diagnosticRecords: [{ correlationId: "corr-ambiguous", occurredAt: "2026-07-23T09:00:00.000Z" }] },
      { workflowId: "definite", summary: "Sales Session provision failed.", outcome: "failure", actor: "Sales admin", subject: "This Sales Session", firstAt: "2026-07-23T09:02:00.000Z", lastAt: "2026-07-23T09:02:00.000Z", count: 1, correlationId: "corr-definite", steps: [{ label: "Sales Session provision failed.", outcome: "failure", occurredAt: "2026-07-23T09:02:00.000Z" }], diagnosticRecords: [{ correlationId: "corr-definite", occurredAt: "2026-07-23T09:02:00.000Z" }] },
    ] } });
    const result = await handleReadSalesSessionWorkspace({ workspace: { read } }, { customerId: "customer-a", sessionId: "session-1" });
    expect(result).toMatchObject({ status: 200, body: { activityGroups: [expect.objectContaining({ correlationId: "corr-ambiguous", outcome: "incomplete" }), expect.objectContaining({ correlationId: "corr-definite", outcome: "failure" })] } });
    expect(JSON.stringify(result.body)).not.toMatch(/loginUrl|Bearer|provider-id|requestJson|responseJson|subjectId=/i);
  });

  it("fails closed for absent, archived, or cross-Customer targets", async () => {
    const read = vi.fn().mockResolvedValue(null);
    const result = await handleReadSalesSessionWorkspace({ workspace: { read } }, { customerId: "customer-a", sessionId: "customer-b-session" });

    expect(result).toEqual({ status: 404, body: { error: "This Sales Session is unavailable for this Customer." } });
    expect(read).toHaveBeenCalledWith("customer-a", "customer-b-session");
  });

  it.each(["missing", "archived", "cross-Customer"])("returns the same safe not-found contract for a %s target", async () => {
    const result = await handleReadSalesSessionWorkspace({ workspace: { read: vi.fn().mockResolvedValue(null) } }, { customerId: "customer-a", sessionId: "session-unavailable" });
    expect(result).toEqual({ status: 404, body: { error: "This Sales Session is unavailable for this Customer." } });
  });

  it("fails a pending pre-dispatch reservation closed as stale without a provider read", async () => {
    const result = await handleReadSalesSessionWorkspace({ workspace: { read: vi.fn().mockResolvedValue({ state: "stale" }) } }, { customerId: "customer-a", sessionId: "session-pending" });
    expect(result).toEqual({ status: 409, body: { error: "This Sales Session is an incomplete local reservation and cannot be opened." } });
  });
});
