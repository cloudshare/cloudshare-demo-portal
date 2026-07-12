import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as GET_CANDIDATES } from "../../app/api/admin/candidates/route";
import { GET as GET_CANDIDATE_DETAIL } from "../../app/api/admin/candidates/[candidateId]/route";

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
  getPortalSessionServices: mockGetServices,
  getCandidateRegistrationServices: mockGetServices,
  getAdminCandidateServices: mockGetServices,
}));

vi.mock("@/auth/portal-session", () => ({
  getPortalAdminSession: mockGetPortalAdminSession,
}));

describe("admin candidates routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({
      get: () => ({ value: "portal-session-1" }),
    });
  });

  it("returns 401 for the candidate roster when the caller is not an authenticated admin", async () => {
    mockGetServices.mockReturnValue({ ensurePortalSeeded: vi.fn() });
    mockGetPortalAdminSession.mockResolvedValue(null);

    const response = await GET_CANDIDATES(
      new Request("http://localhost:3000/api/admin/candidates"),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 401 for candidate detail when the caller is not an authenticated admin", async () => {
    mockGetServices.mockReturnValue({ ensurePortalSeeded: vi.fn() });
    mockGetPortalAdminSession.mockResolvedValue(null);

    const response = await GET_CANDIDATE_DETAIL(
      new Request("http://localhost:3000/api/admin/candidates/candidate-1"),
      { params: Promise.resolve({ candidateId: "candidate-1" }) },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("scopes roster reads to the authenticated admin Customer", async () => {
    const services = {
      ensurePortalSeeded: vi.fn(),
      adminCandidates: {
        listByCustomerId: vi.fn().mockResolvedValue([]),
      },
      diagnostics: {
        append: vi.fn(),
        query: vi.fn(),
      },
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    };
    mockGetServices.mockReturnValue(services);
    mockGetPortalAdminSession.mockResolvedValue({
      userId: "admin-1",
      customerId: "customer-1",
      email: "admin@helioscx.demo",
      role: "admin",
    });

    const response = await GET_CANDIDATES(
      new Request("http://localhost:3000/api/admin/candidates?search=casey"),
    );

    expect(response.status).toBe(200);
    expect(services.adminCandidates.listByCustomerId).toHaveBeenCalledWith(
      "customer-1",
      { search: "casey" },
    );
    expect(await response.json()).toEqual({ candidates: [] });
  });
});
