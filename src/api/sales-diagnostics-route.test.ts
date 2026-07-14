import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getGenericDiagnostics } from "../../app/api/admin/diagnostics/route";
import { GET as getSalesDiagnostics } from "../../app/api/sales/diagnostics/route";

const {
  mockCookies,
  mockGetServices,
  mockGetPortalAdminSession,
  mockBuildAdminDiagnosticLogDeps,
  mockHandleGetDiagnosticLog,
} = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockGetServices: vi.fn(),
  mockGetPortalAdminSession: vi.fn(),
  mockBuildAdminDiagnosticLogDeps: vi.fn(),
  mockHandleGetDiagnosticLog: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mockCookies }));
vi.mock("@/composition", () => ({ getServices: mockGetServices }));
vi.mock("@/auth/portal-session", () => ({ getPortalAdminSession: mockGetPortalAdminSession }));
vi.mock("@/api/admin", () => ({
  buildAdminDiagnosticLogDeps: mockBuildAdminDiagnosticLogDeps,
  handleGetDiagnosticLog: mockHandleGetDiagnosticLog,
}));

describe("Sales diagnostics HTTP isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({ get: () => ({ value: "session-certalis" }) });
    mockGetServices.mockReturnValue({});
    mockBuildAdminDiagnosticLogDeps.mockReturnValue({ diagnostics: "deps" });
    mockHandleGetDiagnosticLog.mockResolvedValue({ status: 200, body: { entries: [], page: { hasMore: false, nextOffset: null } } });
  });

  it("keeps the Sales Customer scope while preserving the requested Sales diagnostic source", async () => {
    mockGetPortalAdminSession.mockResolvedValue({ customerId: "customer-certalis", role: "admin", workspace: "sales" });

    const omitted = await getSalesDiagnostics(new Request("http://localhost:3000/api/sales/diagnostics?operation=account.created"));
    const itemDiagnostics = await getSalesDiagnostics(new Request("http://localhost:3000/api/sales/diagnostics?source=sales-items&operation=item.resource_read"));

    expect(omitted.status).toBe(200);
    expect(itemDiagnostics.status).toBe(200);
    expect(mockHandleGetDiagnosticLog).toHaveBeenNthCalledWith(1, expect.anything(), {
      customerId: "customer-certalis",
      query: { operation: "account.created", source: "sales-records", limit: "101", offset: "0" },
    });
    expect(mockHandleGetDiagnosticLog).toHaveBeenNthCalledWith(2, expect.anything(), {
      customerId: "customer-certalis",
      query: { operation: "account.created", source: "sales-items", limit: "101", offset: "0" },
    });
    expect(mockHandleGetDiagnosticLog).toHaveBeenNthCalledWith(3, expect.anything(), {
      customerId: "customer-certalis",
      query: { operation: "account.created", source: "sales-demo-sessions", limit: "101", offset: "0" },
    });
    expect(mockHandleGetDiagnosticLog).toHaveBeenNthCalledWith(4, expect.anything(), {
      customerId: "customer-certalis",
      query: { source: "sales-items", operation: "item.resource_read" },
    });
  });

  it("does not let a Sales route caller widen support to an arbitrary source", async () => {
    mockGetPortalAdminSession.mockResolvedValue({ customerId: "customer-certalis", role: "admin", workspace: "sales" });

    const response = await getSalesDiagnostics(new Request("http://localhost:3000/api/sales/diagnostics?source=runtime"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "unsupported_sales_diagnostic_source" });
    expect(mockHandleGetDiagnosticLog).not.toHaveBeenCalled();
  });

  it("does not expose generic Customer diagnostics to a Sales workspace session", async () => {
    mockGetPortalAdminSession.mockResolvedValue({ customerId: "customer-certalis", role: "admin", workspace: "sales" });

    const response = await getGenericDiagnostics(new Request("http://localhost:3000/api/admin/diagnostics?source=runtime"));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "sales_diagnostics_route_required" });
    expect(mockHandleGetDiagnosticLog).not.toHaveBeenCalled();
  });

  it("keeps generic diagnostics available to certification workspace admins", async () => {
    mockGetPortalAdminSession.mockResolvedValue({ customerId: "customer-helios", role: "admin", workspace: "certification" });

    const response = await getGenericDiagnostics(new Request("http://localhost:3000/api/admin/diagnostics?source=runtime"));

    expect(response.status).toBe(200);
    expect(mockHandleGetDiagnosticLog).toHaveBeenCalledWith(expect.anything(), {
      customerId: "customer-helios",
      query: { source: "runtime" },
    });
  });
});
