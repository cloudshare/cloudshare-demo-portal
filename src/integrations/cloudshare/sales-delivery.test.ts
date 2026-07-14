import { describe, expect, it, vi } from "vitest";
import { createCloudShareSalesDelivery } from "./sales-delivery";

describe("CloudShare Sales Delivery", () => {
  it("uses the documented direct v4 Sales Experience contract with registered admission and no invitations", async () => {
    const requestV4Detailed = vi.fn()
      .mockResolvedValueOnce({ data: { salesPros: [{ email: "sales-admin@certalis.demo" }] }, request: { method: "GET", path: "/salespros" }, response: { status: 200, body: { salesPros: [{ email: "sales-admin@certalis.demo" }] } } })
      .mockResolvedValueOnce({ data: { id: "sales-1" }, request: { method: "POST", path: "/sales", body: {} }, response: { status: 201, body: { id: "sales-1" } } });
    const delivery = createCloudShareSalesDelivery({ requestV4Detailed } as never);
    await delivery.validateMainSalesPro({ projectId: "project-1", email: "sales-admin@certalis.demo" });
    const result = await delivery.createSession({ name: "Acme Demo", type: "demo", projectId: "project-1", blueprintIds: ["bp-1"], regionIds: ["region-1"], policyId: "policy-1", opportunity: "Acme evaluation", externalId: "certalis:opp:opp-1", start: "2026-07-15T09:00", end: "2026-07-16T09:00", timeZone: "UTC", mainSalesProEmail: "sales-admin@certalis.demo", registrationType: "registeredParticipantsOnly", sendInvitations: "dontSend" });
    expect(result.salesExperienceId).toBe("sales-1");
    expect(requestV4Detailed).toHaveBeenLastCalledWith(expect.objectContaining({ method: "POST", path: "/sales", body: expect.objectContaining({ opportunity: "Acme evaluation", externalId: "certalis:opp:opp-1", registrationType: "registeredParticipantsOnly", sendInvitations: "dontSend", mainSalesPro: { email: "sales-admin@certalis.demo" } }) }));
  });
});
