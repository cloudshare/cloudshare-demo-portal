import { describe, it, expect, vi } from "vitest";
import { createCloudShareGuidedJourneyProvider } from "./guided-journey";
import type { CloudShareClient } from "./client";

function makeClient(response: unknown): CloudShareClient {
  return {
    requestV4: vi.fn().mockResolvedValue(response),
    requestV3: vi.fn(),
  } as unknown as CloudShareClient;
}

const apiResponse = {
  participants: [
    {
      email: "candidate@example.com",
      progress: 75,
      completedTasks: 3,
      totalTasks: 4,
      tasks: [
        { id: "t1", name: "Configure routing", completed: true },
        { id: "t2", name: "Create queue", completed: true },
        { id: "t3", name: "Test flow", completed: true },
        { id: "t4", name: "Validate output", completed: false },
      ],
    },
  ],
};

describe("createCloudShareGuidedJourneyProvider", () => {
  it("maps API response to ParticipantProgress for the first participant", async () => {
    const client = makeClient(apiResponse);
    const provider = createCloudShareGuidedJourneyProvider(client);

    const result = await provider.getParticipantProgress("exp-1");

    expect(result).not.toBeNull();
    expect(result!.percentComplete).toBe(75);
    expect(result!.stepsCompleted).toBe(3);
    expect(result!.stepsTotal).toBe(4);
    expect(result!.steps).toEqual([
      { stepId: "t1", title: "Configure routing", completed: true },
      { stepId: "t2", title: "Create queue", completed: true },
      { stepId: "t3", title: "Test flow", completed: true },
      { stepId: "t4", title: "Validate output", completed: false },
    ]);
    expect(client.requestV4).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/experiences/exp-1/journey/participants",
      }),
    );
  });

  it("returns null when participants list is empty", async () => {
    const client = makeClient({ participants: [] });
    const provider = createCloudShareGuidedJourneyProvider(client);

    const result = await provider.getParticipantProgress("exp-1");
    expect(result).toBeNull();
  });

  it("propagates CloudShare errors (Zod validation or request failures)", async () => {
    const client: CloudShareClient = {
      requestV4: vi.fn().mockRejectedValue(new Error("upstream failure")),
      requestV3: vi.fn(),
    } as unknown as CloudShareClient;
    const provider = createCloudShareGuidedJourneyProvider(client);

    await expect(provider.getParticipantProgress("exp-1")).rejects.toThrow("upstream failure");
  });
});
