import { beforeEach, describe, expect, it, vi } from "vitest";
import SalesSessionPage from "../../app/sales/sessions/[sessionId]/page";

const { mockCookies, mockGetServices, mockGetPortalSession } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockGetServices: vi.fn(),
  mockGetPortalSession: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mockCookies }));
vi.mock("next/navigation", () => ({ redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }) }));
vi.mock("@/composition", () => ({ getPortalSessionServices: mockGetServices }));
vi.mock("@/auth/portal-session", () => ({ getPortalSession: mockGetPortalSession }));
vi.mock("@/web/sales-workspace-chrome", () => ({ SalesWorkspaceChrome: "sales-workspace-chrome" }));
vi.mock("@/web/sales-session-workspace", () => ({ SalesSessionWorkspace: "sales-session-workspace" }));

describe("Sales Session page route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({ get: () => ({ value: "session-certalis" }) });
    mockGetServices.mockReturnValue({});
    mockGetPortalSession.mockResolvedValue({ email: "sales-admin@certalis.demo", role: "admin", workspace: "sales" });
  });

  it("fails repeated local-area and queue-return parameters closed to safe defaults", async () => {
    const page = await SalesSessionPage({
      params: Promise.resolve({ sessionId: "session-1" }),
      searchParams: Promise.resolve({ area: ["activity", "details"], from: ["/sales?tab=sessions&queue=history", "/sales?tab=support"] }),
    });

    expect(page.props.children.props).toMatchObject({
      sessionId: "session-1",
      area: "participants",
      queueHref: "/sales?tab=sessions",
    });
  });

  it("preserves valid single local-area and queue-return parameters", async () => {
    const page = await SalesSessionPage({
      params: Promise.resolve({ sessionId: "session-1" }),
      searchParams: Promise.resolve({ area: "activity", from: "/sales?tab=sessions&queue=history" }),
    });

    expect(page.props.children.props).toMatchObject({
      area: "activity",
      queueHref: "/sales?tab=sessions&queue=history",
    });
  });
});
