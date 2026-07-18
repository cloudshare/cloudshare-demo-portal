import { describe, expect, it, vi } from "vitest";
import { SalesDemoSessionRevisionConflictError } from "@/domain/sales-demo-session";
import { createPrismaSalesDemoSessionRepository } from "./prisma-sales-demo-session-repository";

const session = { id: "session-1", customerId: "certalis", opportunityId: "opp-1", itemId: "item-1", cloudShareSalesExperienceId: "pending:session-1", externalId: "session1", type: "demo" as const, start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC", salesProEmail: "admin@certalis.demo", salesProDisplayName: "Admin", registrationType: "registeredParticipantsOnly" as const, sendInvitations: "salesProsAndParticipants" as const, revision: 1, operationalStatus: "provisioning" as const, createdAt: new Date() };

describe("Prisma Sales Enablement Session repository", () => {
  it("normalizes only the Customer + Opportunity + revision uniqueness violation", async () => {
    const create = vi.fn().mockRejectedValue({ code: "P2002", meta: { target: ["customerId", "opportunityId", "revision"] } });
    const repository = createPrismaSalesDemoSessionRepository({ salesDemoSession: { create } } as never);
    await expect(repository.save(session)).rejects.toBeInstanceOf(SalesDemoSessionRevisionConflictError);
  });
  it("preserves other Prisma uniqueness violations and transient errors", async () => {
    const create = vi.fn().mockRejectedValueOnce({ code: "P2002", meta: { target: ["externalId"] } }).mockRejectedValueOnce(new Error("database transport unavailable"));
    const repository = createPrismaSalesDemoSessionRepository({ salesDemoSession: { create } } as never);
    await expect(repository.save(session)).rejects.toMatchObject({ code: "P2002" });
    await expect(repository.save(session)).rejects.toThrow("database transport unavailable");
  });
});
