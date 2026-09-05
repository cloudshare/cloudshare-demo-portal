import { describe, expect, it, vi } from "vitest";
import { createPrismaSalesSessionWorkspaceRepository } from "./prisma-sales-session-workspace-repository";

describe("Prisma Sales Session workspace repository", () => {
  it("owns Customer and active relationship predicates and never selects protected diagnostic JSON", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const findMany = vi.fn();
    const repository = createPrismaSalesSessionWorkspaceRepository({ salesDemoSession: { findFirst }, diagnosticLogEntry: { findMany } } as never);

    await expect(repository.read("customer-a", "session-b")).resolves.toBeNull();

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { customerId: "customer-a", id: "session-b", opportunity: { archivedAt: null, account: { archivedAt: null } } } }));
    expect(findMany).not.toHaveBeenCalled();
  });

  it("reads Activity through safe metadata columns only", async () => {
    const findMany = vi.fn().mockResolvedValue([{ occurredAt: new Date("2026-07-24T09:00:00Z"), operation: "sales.demo_session.created", outcome: "failure", message: "Bearer token loginUrl=https://unsafe.example", requestJson: "Authorization: secret", responseJson: "envId=provider-reference", actorType: "admin", subjectType: "sales_demo_session", subjectId: "session-1", correlationId: "corr-1" }]);
    const repository = createPrismaSalesSessionWorkspaceRepository({ salesDemoSession: { findFirst: vi.fn().mockResolvedValue({ id: "session-1", customerId: "customer-a", cloudShareSalesExperienceId: "sales-1", sessionName: "Acme", revision: 1, start: "2026-07-25T09:00:00.000Z", end: "2026-07-25T10:00:00.000Z", timeZone: "UTC", operationalStatus: "active", attentionReason: null, experienceStatus: null, experienceStatusObservedAt: null, sendInvitations: "dontSend", opportunity: { name: "Evaluation", account: { name: "Acme" } }, item: { name: "Item" }, participants: [] }) }, diagnosticLogEntry: { findMany } } as never);

    const result = await repository.read("customer-a", "session-1");

    const query = findMany.mock.calls[0][0];
    expect(query.where).toEqual({ customerId: "customer-a", subjectId: "session-1", subjectType: "sales_demo_session" });
    expect(query.select).not.toHaveProperty("requestJson");
    expect(query.select).not.toHaveProperty("responseJson");
    expect(query.select).not.toHaveProperty("detailsJson");
    expect(query.select).not.toHaveProperty("message");
    expect(JSON.stringify(result)).not.toMatch(/Bearer|loginUrl|Authorization|envId|provider-reference/);
  });

  it("marks only a persisted pending pre-dispatch reservation as stale", async () => {
    const repository = createPrismaSalesSessionWorkspaceRepository({ salesDemoSession: { findFirst: vi.fn().mockResolvedValue({ id: "session-pending", cloudShareSalesExperienceId: "pending:reservation", operationalStatus: "provisioning", opportunity: { account: {} } }) }, diagnosticLogEntry: { findMany: vi.fn() } } as never);
    await expect(repository.read("customer-a", "session-pending")).resolves.toEqual({ state: "stale" });
  });
});
