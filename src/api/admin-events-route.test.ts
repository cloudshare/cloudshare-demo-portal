import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryEventLogRepository } from "@/persistence/event-log-repository";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import { GET as getEvents } from "../../app/api/admin/events/route";
import { GET as getDiagnostics } from "../../app/api/admin/diagnostics/route";

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

  it("H: authenticated Customer and admin role isolate protected evidence from ordinary and cross-Customer surfaces", async () => {
    const eventLog = createInMemoryEventLogRepository();
    const diagnostics = createInMemoryDiagnosticLogRepository();
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
      eventId: "legacy-event",
      type: "cloudshare.legacy.failed",
      occurredAt: new Date("2026-07-19T11:00:00.000Z"),
      payload: { customerId: "customer-b", responseBody: protectedMarker },
    } as never);
    await diagnostics.append({
      source: "cloudshare",
      operation: "exam_resume",
      outcome: "failure",
      customerId: "customer-b",
      message: "provider operation failed",
      correlationId: "correlation-b",
      request: { body: { marker: protectedMarker } },
      response: { body: { marker: protectedMarker } },
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
    mockGetServices.mockReturnValue({ eventLog, diagnostics, logger: {} });
    mockGetPortalAdminSession.mockResolvedValue({
      id: "session-b",
      role: "admin",
      customerId: "customer-b",
    });

    const response = await getEvents(
      new Request("http://localhost:3000/api/admin/events?customerId=customer-a&limit=10"),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      events: [{ eventId: "event-b", customerId: "customer-b", correlationId: "correlation-b" }],
    });
    expect(JSON.stringify(body).includes(protectedMarker)).toBe(false);

    const diagnosticsResponse = await getDiagnostics(
      new Request("http://localhost:3000/api/admin/diagnostics?correlationId=correlation-b"),
    );
    expect(diagnosticsResponse.status).toBe(200);
    const diagnosticsBody = await diagnosticsResponse.json() as {
      entries: Array<{ correlationId: string; request: unknown; response: unknown }>;
    };
    expect(diagnosticsBody.entries).toHaveLength(1);
    expect(diagnosticsBody.entries[0].correlationId).toBe(body.events[0].correlationId);
    expect(JSON.stringify(diagnosticsBody.entries[0]).includes(protectedMarker)).toBe(true);
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

    const response = await getEvents(new Request("http://localhost:3000/api/admin/events"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });
});
