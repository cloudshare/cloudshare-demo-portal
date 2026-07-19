import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryEventLogRepository } from "@/persistence/event-log-repository";
import { GET } from "../../app/api/admin/events/route";

const { mockCookies, mockGetServices, mockGetPortalAdminSession } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockGetServices: vi.fn(),
  mockGetPortalAdminSession: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mockCookies }));
vi.mock("@/composition", () => ({ getServices: mockGetServices }));
vi.mock("@/auth/portal-session", () => ({ getPortalAdminSession: mockGetPortalAdminSession }));

describe("GET /api/admin/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({ get: () => ({ value: "portal-session" }) });
  });

  it("derives Customer scope from the authenticated admin session", async () => {
    const eventLog = createInMemoryEventLogRepository();
    const protectedMarker = "synthetic-protected-route-marker";
    await eventLog.append({
      eventId: "event-a",
      customerId: "customer-a",
      correlationId: "correlation-a",
      type: "cloudshare.exam_suspend.failed",
      occurredAt: new Date("2026-07-19T09:00:00.000Z"),
      payload: {
        operation: "exam_suspend",
        outcome: "failure",
        externalIds: { examAttemptId: "attempt-a" },
        ...({ request: { body: protectedMarker }, response: { body: protectedMarker } } as Record<string, unknown>),
      },
    });
    await eventLog.append({
      eventId: "event-b",
      customerId: "customer-b",
      correlationId: "correlation-b",
      type: "cloudshare.exam_resume.failed",
      occurredAt: new Date("2026-07-19T10:00:00.000Z"),
      payload: {
        operation: "exam_resume",
        outcome: "failure",
        externalIds: { examAttemptId: "attempt-b" },
      },
    });
    mockGetServices.mockReturnValue({ eventLog, logger: {} });
    mockGetPortalAdminSession.mockResolvedValue({
      id: "session-b",
      role: "admin",
      customerId: "customer-b",
    });

    const response = await GET(
      new Request("http://localhost:3000/api/admin/events?customerId=customer-a&limit=10"),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      events: [{ eventId: "event-b", customerId: "customer-b", correlationId: "correlation-b" }],
    });
    expect(JSON.stringify(body).includes(protectedMarker)).toBe(false);
  });

  it("rejects callers without an authenticated admin session", async () => {
    const eventLog = createInMemoryEventLogRepository();
    await eventLog.append({
      eventId: "event-a",
      customerId: "customer-a",
      correlationId: "correlation-a",
      type: "cloudshare.exam_suspend.failed",
      occurredAt: new Date("2026-07-19T09:00:00.000Z"),
      payload: { operation: "exam_suspend", outcome: "failure" },
    });
    mockGetServices.mockReturnValue({ eventLog, logger: {} });
    mockGetPortalAdminSession.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost:3000/api/admin/events"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });
});
