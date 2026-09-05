import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockEnsurePortalSeeded,
  mockGetPortalSessionServices,
  mockGetSalesTrialLoginServices,
  mockHandleSalesTrialLogin,
} = vi.hoisted(() => ({
  mockEnsurePortalSeeded: vi.fn(),
  mockGetPortalSessionServices: vi.fn(),
  mockGetSalesTrialLoginServices: vi.fn(),
  mockHandleSalesTrialLogin: vi.fn(),
}));

vi.mock("@/composition", () => ({
  getPortalSessionServices: mockGetPortalSessionServices,
  getSalesTrialLoginServices: mockGetSalesTrialLoginServices,
}));

vi.mock("@/api/portal-auth", () => ({ PORTAL_SESSION_COOKIE: "portal_session" }));
vi.mock("@/api/sales-trial-portal", () => ({ handleSalesTrialLogin: mockHandleSalesTrialLogin }));

import { POST } from "../../app/api/sales-trial/login/route";

describe("Sales Trial login form fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsurePortalSeeded.mockResolvedValue(undefined);
    mockGetPortalSessionServices.mockReturnValue({ ensurePortalSeeded: mockEnsurePortalSeeded });
    mockGetSalesTrialLoginServices.mockReturnValue({});
  });

  it("keeps the Sales Trial return target after a native-form login failure", async () => {
    mockHandleSalesTrialLogin.mockResolvedValue({ status: 401, body: { error: "Invalid email or password" } });

    const response = await POST(
      new Request("http://localhost:3025/api/sales-trial/login?returnTo=%2Fsales-trial", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email: "participant@example.test", password: "wrong-password" }),
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3025/sales-trial/login?error=Invalid+email+or+password&returnTo=%2Fsales-trial");
  });
});
