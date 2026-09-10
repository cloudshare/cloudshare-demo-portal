import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ session: null as unknown, handler: vi.fn(), reconcile: vi.fn(), services: {} as Record<string, unknown> }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => ({ value: "cookie" }) })) }));
vi.mock("@/composition", () => ({ getServices: () => state.services }));
vi.mock("@/auth/portal-session", () => ({ getPortalAdminSession: vi.fn(async () => state.session) }));
vi.mock("@/api/sales-session-refresh", () => ({ handleRefreshSalesSessions: state.handler }));
vi.mock("@/api/sales-session-reconciliation", () => ({ handleReconcileSalesSession: state.reconcile }));
vi.mock("@/persistence/prisma-sales-demo-session-repository", () => ({ createPrismaSalesDemoSessionRepository: () => ({ list: vi.fn(), listForRefresh: vi.fn(), recordExperienceObservations: vi.fn() }) }));
vi.mock("@/integrations/cloudshare/sales-delivery", () => ({ createCloudShareSalesDelivery: () => ({}) }));

import { POST as refresh } from "../../app/api/sales/enablement-sessions/refresh/route";
import { POST as verify } from "../../app/api/sales/enablement-sessions/[sessionId]/verify/route";

describe("Sales refresh and Verify production route composition", () => {
  beforeEach(() => {
    state.session = null;
    state.handler.mockReset().mockResolvedValue({ status: 200, body: { rows: [] } });
    state.reconcile.mockReset().mockResolvedValue({ status: 200, body: { experienceStatus: "inProgress" } });
    state.services = { prisma: {}, cloudshareConnections: { findByCustomerId: vi.fn().mockResolvedValue({ id: "connection" }) }, cloudshareClientFactory: { forConnection: vi.fn() }, diagnosticRecorder: {}, audit: {} };
  });

  it.each([null, { customerId: "candidate", workspace: "candidate" }, { customerId: "other", workspace: "admin" }])("denies non-Sales Admin sessions: %j", async (session) => {
    state.session = session;
    expect((await refresh(new Request("http://localhost/api/sales/enablement-sessions/refresh"))).status).toBe(401);
    expect((await verify(new Request("http://localhost/api/sales/enablement-sessions/x/verify"), { params: Promise.resolve({ sessionId: "x" }) })).status).toBe(401);
    expect(state.handler).not.toHaveBeenCalled();
  });

  it("uses the authenticated Customer and never accepts a client Customer", async () => {
    state.session = { customerId: "helios", userId: "admin", email: "admin@helios.test", workspace: "sales" };
    await refresh(new Request("http://localhost/api/sales/enablement-sessions/refresh?customerId=attacker&targetId=session-1&mode=manual"));
    expect(state.handler).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ customerId: "helios", targetIds: ["session-1"] }));
    expect(JSON.stringify(state.handler.mock.calls[0])).not.toContain("attacker");
  });

  it("composes Verify with the server-derived Customer and exact session id", async () => {
    state.session = { customerId: "helios", userId: "admin", email: "admin@helios.test", workspace: "sales" };
    await verify(new Request("http://localhost/api/sales/enablement-sessions/session-1/verify"), { params: Promise.resolve({ sessionId: "session-1" }) });
    expect(state.reconcile).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ customerId: "helios", sessionId: "session-1" }));
  });
});
