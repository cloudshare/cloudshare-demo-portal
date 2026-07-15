import { describe, expect, it, vi } from "vitest";
import { createCloudShareSalesDelivery } from "./sales-delivery";

describe("CloudShare Sales Delivery", () => {
  it("uses the documented v4 GET and PUT /sales/{id} contracts for controlled operations", async () => {
    const requestV4 = vi.fn().mockResolvedValue({ id: "sales-1", name: "Helios - Renewal (1) - Demo" });
    const delivery = createCloudShareSalesDelivery({ requestV4, requestV3: vi.fn(), requestV3Text: vi.fn() });
    await expect(delivery.readSession("sales-1")).resolves.toMatchObject({ name: "Helios - Renewal (1) - Demo" });
    await delivery.updateSession("sales-1", { name: "Helios - Renewal (2) - Demo", start: "2026-07-16T09:00", end: "2026-07-16T10:00", timeZone: "UTC" });
    expect(requestV4).toHaveBeenNthCalledWith(1, expect.objectContaining({ method: "GET", path: "/sales/sales-1" }));
    expect(requestV4).toHaveBeenNthCalledWith(2, expect.objectContaining({ method: "PUT", path: "/sales/sales-1", body: { name: "Helios - Renewal (2) - Demo", start: "2026-07-16T09:00", end: "2026-07-16T10:00", timeZone: "UTC" } }));
  });
  it("uses the documented direct v4 Sales Experience contract with registered admission and no invitations", async () => {
    const requestV4Detailed = vi.fn()
      .mockResolvedValueOnce({ data: { id: "sales-1" }, request: { method: "POST", path: "/sales", query: { trace: "safe" }, headers: { "x-request-id": "req-1" }, body: {} }, response: { status: 201, headers: { "x-correlation-id": "cloud-1" }, body: { id: "sales-1" }, network: { remoteAddress: "203.0.113.1", transport: "tcp" }, tls: { protocol: "TLSv1.3", authorized: true } } });
    const delivery = createCloudShareSalesDelivery({ requestV4Detailed } as never);
    const result = await delivery.createSession({ name: "Acme Demo", type: "demo", projectId: "project-1", blueprintIds: ["bp-1"], regionIds: ["region-1"], policyId: "policy-1", opportunity: "Acme evaluation", externalId: "a3d9df53a55e4c748c3acb4dd89ae51c", passphrase: "k9X3pL8vQ2mR7sT4wY6zA1bC5dE0fG", start: "2026-07-15T09:00", end: "2026-07-16T09:00", timeZone: "UTC", mainSalesProEmail: "sales-admin@certalis.demo", registrationType: "registeredParticipantsOnly", sendInvitations: "dontSend" });
    expect(result.salesExperienceId).toBe("sales-1");
    expect(result).toMatchObject({ request: { query: { trace: "safe" }, headers: { "x-request-id": "req-1" } }, response: { headers: { "x-correlation-id": "cloud-1" }, network: { remoteAddress: "203.0.113.1" }, tls: { protocol: "TLSv1.3" } } });
    expect(requestV4Detailed).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: "/sales", body: expect.objectContaining({ opportunity: "Acme evaluation", externalId: "a3d9df53a55e4c748c3acb4dd89ae51c", passphrase: "k9X3pL8vQ2mR7sT4wY6zA1bC5dE0fG", registrationType: "registeredParticipantsOnly", sendInvitations: "dontSend", mainSalesPro: { email: "sales-admin@certalis.demo" } }) }));
  });
});
