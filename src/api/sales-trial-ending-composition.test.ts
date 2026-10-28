import { describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ services: vi.fn(), session: vi.fn(), handler: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "session" }) }) }));
vi.mock("@/composition", () => ({ getServices: mocks.services }));
vi.mock("@/auth/portal-session", () => ({ getPortalAdminSession: mocks.session }));
vi.mock("@/api/sales-trial-offerings", () => ({ handleEndSalesTrialOffering: mocks.handler }));
import { POST } from "../../app/api/sales/trial-offerings/[id]/end/route";
import { salesTrialEndingDeps } from "./sales-trial-ending-reconciliation";
import type { Services } from "@/composition";
describe("Trial Ending Item composition", () => {
  it("wires the real Item lookup into background and HTTP ending", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const services = { prisma: { item: { findUnique } }, ensurePortalSeeded: vi.fn() } as unknown as Services;
    await salesTrialEndingDeps(services).items.findById("item-background");
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "item-background" } });
    mocks.services.mockReturnValue(services);
    mocks.session.mockResolvedValue({ workspace: "sales", customerId: "customer-1", userId: "admin-1", email: "admin@example.test" });
    mocks.handler.mockImplementation(async deps => { await deps.items.findById("item-route"); return { status: 200, body: {} }; });
    await POST(new Request("http://localhost/api/sales/trial-offerings/offering/end", { method: "POST" }), { params: Promise.resolve({ id: "offering" }) });
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "item-route" } });
  });
});
