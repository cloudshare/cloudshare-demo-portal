import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  forConnection: vi.fn().mockReturnValue({}),
  createSource: vi.fn().mockReturnValue({}),
  handle: vi.fn(),
}));

vi.mock("@/composition", () => ({ getServices: () => ({
  ensurePortalSeeded: vi.fn(),
  cloudshareClientFactory: { forConnection: mocks.forConnection },
  cloudshareConnections: {},
  prisma: {},
  diagnosticRecorder: {},
  audit: {},
}) }));
vi.mock("@/auth/portal-session", () => ({ getPortalAdminSession: vi.fn().mockResolvedValue({ workspace: "sales", customerId: "customer-a", userId: "admin-a", email: "admin@example.test" }) }));
vi.mock("next/headers", () => ({ cookies: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue({ value: "session" }) }) }));
vi.mock("@/persistence/prisma-item-repository", () => ({ createPrismaItemRepository: vi.fn().mockReturnValue({}) }));
vi.mock("@/integrations/cloudshare/project-members", () => ({ createCloudShareProjectMemberSource: mocks.createSource }));
vi.mock("@/api/sales-project-members", () => ({ handleListSalesProjectMembers: mocks.handle }));

import { GET } from "../../app/api/sales/enablement-sessions/project-members/route";

describe("Sales Project-members Next route", () => {
  it("passes the dedicated preflight reason to the CloudShare client", async () => {
    mocks.handle.mockImplementation(async (deps: { sourceFactory: { forConnection: (connection: unknown) => unknown } }) => {
      deps.sourceFactory.forConnection({ customerId: "customer-a" });
      return { status: 200, body: { members: [] } };
    });

    await GET(new Request("http://localhost/api/sales/enablement-sessions/project-members?itemId=item-a"));

    expect(mocks.forConnection).toHaveBeenCalledWith({ customerId: "customer-a" }, { scope: "customer_default", reason: "sales_project_member_preflight" });
    expect(mocks.createSource).toHaveBeenCalledWith({});
  });
});
