import { describe, it, expect, vi } from "vitest";
import { createInMemoryEventBus } from "./event-bus";
import type { ExamAttemptCreatedEvent } from "./integration-event";

const event: ExamAttemptCreatedEvent = {
  id: "evt-1",
  occurredAt: new Date(0),
  type: "exam_attempt.created",
  examAttemptId: "ea-1",
  candidateId: "c-1",
  examId: "ex-1",
};

describe("createInMemoryEventBus", () => {
  it("delivers a published event to subscribers of that type", async () => {
    const bus = createInMemoryEventBus();
    const handler = vi.fn();
    bus.subscribe("exam_attempt.created", handler);

    await bus.publish(event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toEqual(event);
  });

  it("does not deliver to handlers subscribed to a different type", async () => {
    const bus = createInMemoryEventBus();
    const handler = vi.fn();
    // @ts-expect-error — a type not in the union, to prove routing is by type.
    bus.subscribe("something.else", handler);

    await bus.publish(event);
    expect(handler).not.toHaveBeenCalled();
  });

  it("isolates a failing handler so others still run, routing the error to onError", async () => {
    const onError = vi.fn();
    const bus = createInMemoryEventBus({ onError });
    const boom = vi.fn(() => {
      throw new Error("handler boom");
    });
    const ok = vi.fn();
    bus.subscribe("exam_attempt.created", boom);
    bus.subscribe("exam_attempt.created", ok);

    await bus.publish(event);

    expect(ok).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
  });
});
