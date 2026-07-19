import { describe, expect, it } from "vitest";
import { createInMemoryEventLogRepository } from "./event-log-repository";

describe("EventLogRepository", () => {
  it("projects append input to the typed metadata-only event shape", async () => {
    const repository = createInMemoryEventLogRepository();

    await repository.append({
      eventId: "event-a-1",
      customerId: "customer-a",
      correlationId: "correlation-a-1",
      type: "cloudshare.exam_suspend.failed",
      occurredAt: new Date("2026-07-19T09:00:00.000Z"),
      payload: {
        operation: "exam_suspend",
        integrationSurface: "cloudshare.v3.env.action.suspend",
        outcome: "failure",
        responseStatus: 503,
        failureMode: "http_status",
        actor: { type: "candidate", id: "candidate-a", email: "candidate-a@example.test" },
        externalIds: {
          examAttemptId: "attempt-a",
          examId: "exam-a",
          environmentId: "environment-a",
        },
        ...({
          request: { body: "PROTECTED_REQUEST_BODY_MARKER" },
          response: { body: "PROTECTED_RESPONSE_BODY_MARKER" },
          accessLink: "PROTECTED_ACCESS_LINK_MARKER",
        } as Record<string, unknown>),
      },
    });

    const events = await repository.listByCustomerId("customer-a");

    expect(events).toEqual([
      {
        eventId: "event-a-1",
        customerId: "customer-a",
        correlationId: "correlation-a-1",
        type: "cloudshare.exam_suspend.failed",
        occurredAt: new Date("2026-07-19T09:00:00.000Z"),
        payload: {
          operation: "exam_suspend",
          integrationSurface: "cloudshare.v3.env.action.suspend",
          outcome: "failure",
          responseStatus: 503,
          failureMode: "http_status",
          actor: { type: "candidate", id: "candidate-a", email: "candidate-a@example.test" },
          externalIds: {
            examAttemptId: "attempt-a",
            examId: "exam-a",
            environmentId: "environment-a",
          },
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("PROTECTED_");
  });

  it("returns only exact Customer matches newest-first and applies the limit after scoping", async () => {
    const repository = createInMemoryEventLogRepository();
    const append = (eventId: string, customerId: string, occurredAt: string) =>
      repository.append({
        eventId,
        customerId,
        correlationId: `correlation-${eventId}`,
        type: "exam_attempt.created",
        occurredAt: new Date(occurredAt),
        payload: {
          operation: "exam_attempt.create",
          outcome: "success",
          externalIds: { examAttemptId: `attempt-${eventId}` },
        },
      });

    await append("a-old", "customer-a", "2026-07-19T09:00:00.000Z");
    await append("b-newest", "customer-b", "2026-07-19T11:00:00.000Z");
    await append("a-new", "customer-a", "2026-07-19T10:00:00.000Z");

    await expect(repository.listByCustomerId("customer-a", 1)).resolves.toMatchObject([
      { eventId: "a-new", customerId: "customer-a" },
    ]);
  });

  it("fails closed for legacy or unscoped append input", async () => {
    const repository = createInMemoryEventLogRepository();

    await repository.append({
      eventId: "legacy-event",
      type: "cloudshare.legacy.failed",
      occurredAt: new Date("2026-07-19T09:00:00.000Z"),
      payload: { customerId: "customer-a", responseBody: "PROTECTED_LEGACY_BODY_MARKER" },
    } as never);

    await expect(repository.listByCustomerId("customer-a")).resolves.toEqual([]);
  });
});
