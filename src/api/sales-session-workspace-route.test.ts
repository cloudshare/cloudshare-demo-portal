import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as unknown,
  services: null as any,
  handler: vi.fn(),
  repository: { read: vi.fn() },
}));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => ({ value: "cookie" }) })) }));
vi.mock("@/composition", () => ({ getServices: () => state.services }));
vi.mock("@/auth/portal-session", () => ({ getPortalAdminSession: vi.fn(async () => state.session) }));
vi.mock("@/api/sales-session-workspace", () => ({ handleReadSalesSessionWorkspace: state.handler }));
vi.mock("@/persistence/prisma-sales-session-workspace-repository", () => ({ createPrismaSalesSessionWorkspaceRepository: vi.fn(() => state.repository) }));

import { GET } from "../../app/api/sales/enablement-sessions/[sessionId]/workspace/route";

const request = (url = "http://localhost/api/sales/enablement-sessions/session-1/workspace") => new Request(url);
const routeParams = (sessionId = "session-1") => ({ params: Promise.resolve({ sessionId }) });

describe("Sales workspace route authorization and public contract", () => {
  beforeEach(() => {
    state.session = null;
    state.handler.mockReset().mockResolvedValue({ status: 200, body: { activityGroups: [], activityHistory: { complete: true, hasMore: false } } });
    state.repository.read.mockReset();
    state.services = { prisma: {}, ensurePortalSeeded: vi.fn(), cloudshareConnections: { findByCustomerId: vi.fn() }, cloudshareClientFactory: { forConnection: vi.fn() } };
  });

  it.each([
    ["missing session", null],
    ["candidate session", { customerId: "helios", userId: "candidate", role: "candidate", workspace: "sales" }],
    ["non-admin session", { customerId: "helios", userId: "user", role: "admin", workspace: "candidate" }],
    ["admin in non-sales workspace", { customerId: "helios", userId: "admin", role: "admin", workspace: "provider" }],
  ])("denies %s without invoking the handler", async (_label, session) => {
    state.session = session;
    expect((await GET(request(), routeParams())).status).toBe(401);
    expect(state.handler).not.toHaveBeenCalled();
  });

  it("allows only the same-Customer Sales admin and derives all inputs server-side", async () => {
    state.session = { customerId: "helios", userId: "admin", role: "admin", workspace: "sales" };
    await GET(request(`${request().url}?customerId=attacker`), routeParams("session-from-route"));
    expect(state.handler).toHaveBeenCalledWith(expect.objectContaining({ workspace: state.repository }), { customerId: "helios", sessionId: "session-from-route" });
    expect(JSON.stringify(state.handler.mock.calls[0])).not.toContain("attacker");
    expect(state.services.cloudshareConnections.findByCustomerId).not.toHaveBeenCalled();
    expect(state.services.cloudshareClientFactory.forConnection).not.toHaveBeenCalled();
    expect(state.services.ensurePortalSeeded).not.toHaveBeenCalled();
  });

  it.each([
    [404, { error: "This Sales Session is unavailable for this Customer." }],
    [409, { error: "This Sales Session is an incomplete local reservation and cannot be opened." }],
  ])("passes through handler %s status/body without protected leakage", async (status, body) => {
    state.session = { customerId: "helios", userId: "admin", role: "admin", workspace: "sales" };
    state.handler.mockResolvedValue({ status, body });
    const response = await GET(request(), routeParams());
    expect(response.status).toBe(status);
    const responseBody = await response.json();
    expect(responseBody).toEqual(body);
    expect(JSON.stringify(responseBody)).not.toContain("SENTINEL_PROTECTED_BODY");
  });
});
