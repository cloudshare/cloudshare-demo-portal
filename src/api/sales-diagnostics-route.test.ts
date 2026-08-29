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
      query: { operation: "account.created", source: "sales-session-reconciliation", limit: "101", offset: "0" },
    });
    expect(mockHandleGetDiagnosticLog).toHaveBeenNthCalledWith(5, expect.anything(), {
      customerId: "customer-certalis",
      query: { operation: "account.created", source: "sales-session-participants", limit: "101", offset: "0" },
    });
    expect(mockHandleGetDiagnosticLog).toHaveBeenNthCalledWith(6, expect.anything(), {
      customerId: "customer-certalis",
      query: { operation: "account.created", source: "sales-project-members", limit: "101", offset: "0" },
    });
    expect(mockHandleGetDiagnosticLog).toHaveBeenNthCalledWith(7, expect.anything(), {
      customerId: "customer-certalis",
      query: { operation: "account.created", source: "sales-participant-launch", limit: "101", offset: "0" },
    });
    expect(mockHandleGetDiagnosticLog).toHaveBeenNthCalledWith(8, expect.anything(), {
      customerId: "customer-certalis",
      query: { operation: "account.created", source: "sales-trial-offerings", limit: "101", offset: "0" },
    });
    expect(mockHandleGetDiagnosticLog).toHaveBeenNthCalledWith(9, expect.anything(), {
      customerId: "customer-certalis",
      query: { source: "sales-items", operation: "item.resource_read" },
    });
  });

  it("retrieves Customer-scoped launch correlations through the Sales diagnostics source", async () => {
    mockGetPortalAdminSession.mockResolvedValue({ customerId: "customer-certalis", role: "admin", workspace: "sales" });
    const protectedEntry = { source: "sales-participant-launch", operation: "sales.demo_session.participant_launch.opened", outcome: "success", correlationId: "corr-launch-1", subject: { type: "sales_session_participant", id: "participant-1" }, request: { path: "/sales/launch/private-capability", headers: { authorization: "Bearer private-auth", "Content-Type": "application/json" }, body: { sponsoredLinkRequest: true } }, response: { status: 200, body: { loginUrl: "https://cloudshare.example.test/private-provider-url", passphrase: "provider-passphrase" } }, details: { nested: { token: "private-token", path: "/sales/launch/another-capability" } } };
    mockHandleGetDiagnosticLog.mockResolvedValueOnce({ status: 200, body: { entries: [protectedEntry], page: { hasMore: false, nextOffset: null } } });
    const response = await getSalesDiagnostics(new Request("http://localhost:3000/api/sales/diagnostics?source=sales-participant-launch&correlationId=corr-launch-1&subjectId=participant-1"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.entries[0]).toMatchObject({ source: "sales-participant-launch", correlationId: "corr-launch-1" });
    const serialized = JSON.stringify(body);
    expect(serialized).toContain("private-capability");
    expect(serialized).toContain("private-provider-url");
    expect(serialized).toContain("private-token");
    expect(serialized).not.toContain("private-auth");
    expect(body.entries[0].request.headers.authorization).toBe("[REDACTED]");
    expect(body.entries[0].request.headers["Content-Type"]).toBe("application/json");
    expect(body.entries[0].request.body).toEqual({ sponsoredLinkRequest: true });
    expect(body.entries[0].response.body).toEqual({ loginUrl: "https://cloudshare.example.test/private-provider-url", passphrase: "provider-passphrase" });
    expect(body.entries[0]).toMatchObject({ correlationId: "corr-launch-1", outcome: "success", response: { status: 200, body: { loginUrl: "https://cloudshare.example.test/private-provider-url" } } });
    expect(mockHandleGetDiagnosticLog).toHaveBeenCalledWith(expect.anything(), { customerId: "customer-certalis", query: { source: "sales-participant-launch", correlationId: "corr-launch-1", subjectId: "participant-1" } });
  });

  it("applies the same bearer-safe projection to aggregate Sales diagnostics", async () => {
    mockGetPortalAdminSession.mockResolvedValue({ customerId: "customer-certalis", role: "admin", workspace: "sales" });
    mockHandleGetDiagnosticLog.mockImplementation(async (_deps, request) => ({ status: 200, body: { entries: request.query.source === "sales-participant-launch" ? [{ source: "sales-participant-launch", correlationId: "corr-aggregate", response: { status: 200, body: { loginUrl: "https://provider/private" } }, details: { launch: "/sales/launch/private-capability" } }] : [], page: { hasMore: false, nextOffset: null } } }));
    const response = await getSalesDiagnostics(new Request("http://localhost:3000/api/sales/diagnostics"));
    const body = await response.json(); const serialized = JSON.stringify(body);
    expect(serialized).toContain("corr-aggregate"); expect(serialized).toContain('"status":200');
    expect(serialized).toContain("https://provider/private"); expect(serialized).toContain("private-capability");
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

  it.each([
    ["generic", getGenericDiagnostics, "http://localhost:3000/api/admin/diagnostics"],
    ["Sales", getSalesDiagnostics, "http://localhost:3000/api/sales/diagnostics"],
  ])("denies unauthenticated access to %s diagnostics", async (_name, route, url) => {
    mockGetPortalAdminSession.mockResolvedValue(null);

    const response = await route(new Request(url));

    expect(response.status).toBe(401);
    expect(mockHandleGetDiagnosticLog).not.toHaveBeenCalled();
  });

  it.each([
    ["generic", getGenericDiagnostics, "http://localhost:3000/api/admin/diagnostics", "certification"],
    ["Sales", getSalesDiagnostics, "http://localhost:3000/api/sales/diagnostics", "sales"],
  ])("denies non-admin access to %s diagnostics", async (_name, route, url, workspace) => {
    mockGetPortalAdminSession.mockResolvedValue({ customerId: "customer-helios", role: "candidate", workspace });

    const response = await route(new Request(url));

    expect(response.status).toBe(403);
    expect(mockHandleGetDiagnosticLog).not.toHaveBeenCalled();
  });

  it("ignores caller-supplied Customer IDs and enforces the Helios session scope", async () => {
    mockGetPortalAdminSession.mockResolvedValue({ customerId: "customer-helios", role: "admin", workspace: "certification" });

    await getGenericDiagnostics(new Request("http://localhost:3000/api/admin/diagnostics?customerId=customer-certalis&source=runtime"));

    expect(mockHandleGetDiagnosticLog).toHaveBeenCalledWith(expect.anything(), {
      customerId: "customer-helios",
      query: { customerId: "customer-certalis", source: "runtime" },
    });
  });
});
