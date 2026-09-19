import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ session: null as unknown, submit: vi.fn(), latest: vi.fn(), refresh: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "cookie" }) }) }));
vi.mock("@/composition", () => ({ getServices: () => ({ ensurePortalSeeded: async () => {}, salesParticipantExtension: { submit: state.submit, latest: state.latest, refresh: state.refresh } }) }));
vi.mock("@/auth/portal-session", () => ({ getPortalAdminSession: async () => state.session }));
import { GET, POST } from "../../app/api/sales/enablement-sessions/[sessionId]/participants/extend/route";
import { POST as refresh } from "../../app/api/sales/enablement-sessions/[sessionId]/participants/refresh/route";
const params = () => ({ params: Promise.resolve({ sessionId: "s1" }) });
beforeEach(() => { state.session = null; state.refresh.mockReset().mockResolvedValue({ status: 200, body: { outcome: "refreshed" } }); state.submit.mockReset().mockResolvedValue({ status: 202, body: { outcome: "needs_attention" } }); state.latest.mockReset().mockResolvedValue(null); });
it("requires a Sales Admin before accessing extension state", async () => {
  state.session = { workspace: "certification", customerId: "c1" };
  expect((await GET(new Request("http://x"), params())).status).toBe(401);
  expect((await POST(new Request("http://x", { method: "POST", body: "{}" }), params())).status).toBe(401);
  expect(state.latest).not.toHaveBeenCalled(); expect(state.submit).not.toHaveBeenCalled();
});
it("derives Customer and actor from authentication and keeps results uncached", async () => {
  state.session = { workspace: "sales", customerId: "c1", userId: "admin1", email: "admin@example.test" };
  const response = await POST(new Request("http://x?customerId=other", { method: "POST", body: JSON.stringify({ commandId: "command" }) }), params());
  expect(response.status).toBe(202); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(state.submit).toHaveBeenCalledWith(expect.objectContaining({ customerId: "c1", sessionId: "s1", actor: { type: "admin", id: "admin1", email: "admin@example.test" } }));
  await GET(new Request("http://x?customerId=other"), params()); expect(state.latest).toHaveBeenCalledWith("c1", "s1");
});

it("authenticates eligibility refresh and derives scope rather than trusting submitted Customer IDs", async () => {
  expect((await refresh(new Request("http://x"), params())).status).toBe(401);
  expect(state.refresh).not.toHaveBeenCalled();
  state.session = { workspace: "sales", customerId: "c1", userId: "admin1", email: "admin@example.test" };
  const response = await refresh(new Request("http://x?customerId=other", { method: "POST", body: JSON.stringify({ customerId: "other" }) }), params());
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ outcome: "refreshed" });
  expect(state.refresh).toHaveBeenCalledWith({ customerId: "c1", sessionId: "s1", actor: { type: "admin", id: "admin1", email: "admin@example.test" } });
});
