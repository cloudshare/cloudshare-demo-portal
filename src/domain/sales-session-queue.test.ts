import { describe, expect, it } from "vitest";
import { belongsInSalesSessionQueue, classifySalesSessionQueueRow } from "./sales-session-queue";

const candidate = (overrides: Record<string, unknown> = {}) => ({ id: "session-1", customerId: "customer-a", accountId: "account-1", accountName: "Acme", opportunityId: "opp-1", opportunityName: "Renewal", itemId: "item-1", cloudShareSalesExperienceId: "server-only", externalId: "opaque", type: "demo" as const, start: "2026-07-25T09:00", end: "2026-07-25T10:00", timeZone: "UTC", salesProEmail: "sales@example.test", salesProDisplayName: "Sales", registrationType: "registeredParticipantsOnly" as const, sendInvitations: "dontSend" as const, createdAt: new Date("2026-07-20T00:00:00Z"), ...overrides });

describe("Sales Session queue status classification", () => {
  it("keeps provider experience views separate from a Certalis operation exception", () => {
    const row = classifySalesSessionQueueRow(candidate({ operationalStatus: "needs_attention", attentionReason: "Correlation needs support", experienceStatus: "inProgress", experienceStatusObservedAt: new Date("2026-07-23T09:58:00Z") }), new Date("2026-07-23T10:00:00Z"));
    expect(row.operation).toMatchObject({ dimension: "certalis_operation", value: "needs_attention" });
    expect(row.experience).toMatchObject({ dimension: "cloudshare_sales_experience", value: "inProgress" });
    expect(belongsInSalesSessionQueue(row, "active")).toBe(true);
    expect(belongsInSalesSessionQueue(row, "needs_attention")).toBe(true);
  });

  it("surfaces a participant-environment exception with its own affected entity", () => {
    const row = classifySalesSessionQueueRow(candidate({ participantEnvironment: { participantName: "Ari Example", attentionReason: "Environment could not be correlated.", observation: { dimension: "cloudshare_environment", value: "Ready", source: "cloudshare_v4_sales_participant_roster", observedAt: "2026-07-23T09:00:00.000Z" } } }), new Date("2026-07-23T10:00:00Z"));
    expect(row.attention).toEqual({ entity: "Ari Example", dimension: "participant_environment", reason: "Environment could not be correlated." });
    expect(belongsInSalesSessionQueue(row, "needs_attention")).toBe(true);
    expect(belongsInSalesSessionQueue(row, "active")).toBe(true);
  });
});
