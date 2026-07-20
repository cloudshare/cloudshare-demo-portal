import { describe, expect, it } from "vitest";
import { parseSalesSessionProvisionDraft, salesSessionProvisionDraftKey } from "./sales-session-provision-draft";

describe("Sales Session Provision draft", () => {
  it("accepts only the versioned, creation-only browser form model", () => {
    expect(parseSalesSessionProvisionDraft(JSON.stringify({ version: 1, accountId: "account-1", opportunityId: "opp-1", itemId: "item-1", salesProEmail: "rep@example.test", startMode: "scheduled", start: "2026-07-20T09:00", end: "2026-07-20T10:00", endHasManualOverride: true, timeZone: "UTC", type: "demo", sessionNameTemplate: "{opportunity} ({revision})" }))).toMatchObject({ version: 1, opportunityId: "opp-1", startMode: "scheduled" });
    expect(parseSalesSessionProvisionDraft(JSON.stringify({ version: 2, diagnostics: { responseBody: "protected" } }))).toBeNull();
    expect(parseSalesSessionProvisionDraft("not-json")).toBeNull();
  });

  it("partitions drafts by normalized Sales Admin identity", () => {
    expect(salesSessionProvisionDraftKey(" Sales-Admin@Certalis.Demo ")).toBe("certalis:sales-session-provision:v1:sales-admin%40certalis.demo");
  });
});
