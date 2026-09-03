import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockEnsurePortalSeeded,
  mockGetPortalLoginServices,
  mockGetPortalSessionServices,
  mockHandlePortalLogin,
} = vi.hoisted(() => ({
  mockEnsurePortalSeeded: vi.fn(),
  mockGetPortalLoginServices: vi.fn(),
  mockGetPortalSessionServices: vi.fn(),
  mockHandlePortalLogin: vi.fn(),
}));

vi.mock("@/composition", () => ({
  getPortalLoginServices: mockGetPortalLoginServices,
  getPortalSessionServices: mockGetPortalSessionServices,
}));

vi.mock("@/api/portal-auth", () => ({
  buildPortalLoginDeps: vi.fn(() => ({})),
  handlePortalLogin: mockHandlePortalLogin,
  PORTAL_SESSION_COOKIE: "portal_session",
}));

import { POST } from "../../app/api/auth/login/route";

describe("shared portal login form fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsurePortalSeeded.mockResolvedValue(undefined);
    mockGetPortalSessionServices.mockReturnValue({ ensurePortalSeeded: mockEnsurePortalSeeded });
    mockGetPortalLoginServices.mockReturnValue({});
  });

  it("redirects a Sales Trial participant to the Sales Trial home", async () => {
    mockHandlePortalLogin.mockResolvedValue({
      status: 200,
      body: {},
      session: {
        sessionId: "session-trial-1",
        userId: "trial-user-1",
        customerId: "customer-certalis",
        email: "visitor@example.test",
        role: "sales_trial_participant",
        workspace: "sales",
        issuedAtMs: 1,
      },
    });

    const response = await POST(
      new Request("http://localhost:3025/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email: "visitor@example.test", password: "test-password" }),
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3025/sales-trial");
  });

  it("reauthorizes a safe return target after login instead of trusting its requested workspace", async () => {
    mockHandlePortalLogin.mockResolvedValue({
      status: 200,
      body: { session: { role: "candidate" } },
      session: {
        sessionId: "session-candidate-1",
        userId: "candidate-1",
        customerId: "customer-helios",
        email: "candidate@helioscx.demo",
        role: "candidate",
        workspace: "certification",
        issuedAtMs: 1,
      },
    });

    const response = await POST(
      new Request("http://localhost:3025/api/auth/login?returnTo=%2Fadmin%3Ftab%3Dexams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "candidate@helioscx.demo", password: "test-password" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      session: { role: "candidate" },
      redirectTo: "/candidate",
    });
  });
});
