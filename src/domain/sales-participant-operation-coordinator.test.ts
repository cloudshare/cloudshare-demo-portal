import { describe, expect, it, vi } from "vitest";
import { createSalesParticipantOperationCoordinator } from "./sales-participant-operation-coordinator";

describe("Sales Participant operation coordinator", () => {
  it("serializes commands for one participant capability and returns the safe outcome", async () => {
    let release!: () => void;
    const first = new Promise<void>((resolve) => { release = resolve; });
    const execute = vi.fn()
      .mockImplementationOnce(async () => { await first; return { disposition: "confirmed" as const, metadata: { status: 200 } }; })
      .mockResolvedValueOnce({ disposition: "confirmed" as const, metadata: { status: 200 } });
    const coordinator = createSalesParticipantOperationCoordinator({ execute });

    const a = coordinator.run({ participantId: "p1", capability: "email", operation: "invite" });
    const b = coordinator.run({ participantId: "p1", capability: "email", operation: "resend" });
    await Promise.resolve();
    expect(execute).toHaveBeenCalledTimes(1);
    release();
    await expect(a).resolves.toMatchObject({ disposition: "confirmed", metadata: { status: 200 } });
    await expect(b).resolves.toMatchObject({ disposition: "confirmed" });
    expect(execute).toHaveBeenNthCalledWith(2, expect.objectContaining({ operation: "resend" }));
  });

  it("keeps no-replay state distinct from a retryable pre-dispatch failure", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ disposition: "no_replay" as const, correlationId: "c1", metadata: { status: 502 } })
      .mockResolvedValueOnce({ disposition: "failed_retryable" as const, metadata: { status: 503 } });
    const coordinator = createSalesParticipantOperationCoordinator({ execute });

    await expect(coordinator.run({ participantId: "p1", capability: "email", operation: "invite" })).resolves.toMatchObject({ disposition: "no_replay", correlationId: "c1" });
    await expect(coordinator.run({ participantId: "p1", capability: "launch", operation: "launch" })).resolves.toMatchObject({ disposition: "failed_retryable", metadata: { status: 503 } });
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
