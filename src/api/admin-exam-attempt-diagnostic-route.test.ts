import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../app/api/admin/diagnostics/attempts/[examAttemptId]/route";

const {
  mockCookies,
  mockGetServices,
  mockGetPortalAdminSession,
} = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockGetServices: vi.fn(),
  mockGetPortalAdminSession: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mockCookies,
}));

vi.mock("@/composition", () => ({
  getServices: mockGetServices,
}));

vi.mock("@/auth/portal-session", () => ({
  getPortalAdminSession: mockGetPortalAdminSession,
}));

describe("admin ExamAttempt diagnostic drilldown route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({
      get: () => ({ value: "portal-session-1" }),
    });
  });

  it("returns 401 when the caller is not an authenticated admin", async () => {
    mockGetServices.mockReturnValue({});
    mockGetPortalAdminSession.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost:3000/api/admin/diagnostics/attempts/attempt-1"),
      { params: Promise.resolve({ examAttemptId: "attempt-1" }) },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });
});
