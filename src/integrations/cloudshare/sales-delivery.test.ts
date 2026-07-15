import { describe, expect, it, vi } from "vitest";
import { createCloudShareSalesDelivery } from "./sales-delivery";

describe("CloudShare Sales Delivery", () => {
  it("uses documented v4 GET /sales/{id} only for reconciliation", async () => {
    const requestV4 = vi.fn().mockResolvedValue({ id: "sales-1", status: "active" });
    const delivery = createCloudShareSalesDelivery({ requestV4, requestV3: vi.fn(), requestV3Text: vi.fn() });
    await expect(delivery.readSession("sales-1")).resolves.toMatchObject({ id: "sales-1", status: "active" });
    expect(requestV4).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/sales/sales-1" }));
  });
  it("reads the documented full model before sending a full PUT /sales/{id}", async () => {
    const full = { id: "sales-1", accessLink: "bearer-secret", name: "Original", type: "demo", projectId: "project-1", blueprintIds: ["bp-1"], cloudshareRegionIds: ["region-1"], policyId: "policy-1", opportunity: "Acme", mainSalesPro: { email: "sales@certalis.demo" }, registrationType: "registeredParticipantsOnly", start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC" };
    const requestV4Detailed = vi.fn().mockResolvedValueOnce({ data: full, request: { method: "GET", path: "/sales/sales-1" }, response: { status: 200, body: full } }).mockResolvedValueOnce({ data: { ...full, name: "Renamed" }, request: { method: "PUT", path: "/sales/sales-1", body: { ...full, name: "Renamed" } }, response: { status: 200, body: { ...full, name: "Renamed" } } });
    const delivery = createCloudShareSalesDelivery({ requestV4Detailed } as never);
    await expect(delivery.updateSession!("sales-1", { name: "Renamed" })).resolves.toMatchObject({ id: "sales-1", request: { method: "PUT" } });
    expect(requestV4Detailed).toHaveBeenLastCalledWith(expect.objectContaining({ method: "PUT", path: "/sales/sales-1", body: expect.objectContaining({ name: "Renamed", projectId: "project-1", blueprintIds: ["bp-1"], mainSalesPro: { email: "sales@certalis.demo" } }) }));
    expect(requestV4Detailed.mock.calls[1][0].body).not.toHaveProperty("accessLink");
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
