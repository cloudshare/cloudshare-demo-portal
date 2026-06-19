import { describe, it, expect, vi } from "vitest";
import { createCloudShareGuidedJourneyProvider } from "./guided-journey";
import type { CloudShareClient } from "./client";
import { CloudShareRequestError } from "./errors";

function makeClient(response: unknown): CloudShareClient {
  return {
    requestV4: vi.fn(async (spec: { schema: { parse(value: unknown): unknown } }) => spec.schema.parse(response)),
    requestV3: vi.fn(),
  } as unknown as CloudShareClient;
}

const apiResponse = {
  participantId: "student-1",
  experienceId: "exp-1",
  progressRate: 75,
  sections: [
    { id: "t1", name: "Configure routing", status: "completed" },
    { id: "t2", name: "Create queue", status: "completed" },
    { id: "t3", name: "Test flow", status: "completed" },
    { id: "t4", name: "Validate output", status: "in_progress" },
  ],
};

describe("createCloudShareGuidedJourneyProvider", () => {
  it("maps documented guided-journey progress payloads by participant id", async () => {
    const client = makeClient(apiResponse);
    const provider = createCloudShareGuidedJourneyProvider(client);

    const result = await provider.getParticipantProgress("exp-1", "student-1");

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
        path: "/guided-journey/progress/exp-1/student-1",
      }),
    );
  });

  it("returns null when no progress sections are present", async () => {
    const client = makeClient({ participantId: "student-1", experienceId: "exp-1", progressRate: 0, sections: [] });
    const provider = createCloudShareGuidedJourneyProvider(client);

    const result = await provider.getParticipantProgress("exp-1", "student-1");
    expect(result).toBeNull();
  });

  it("treats documented numeric completed-style statuses as completed steps", async () => {
    const client = makeClient({
      participantId: "student-1",
      experienceId: "exp-1",
      sections: [
        { id: "t1", name: "Explore dashboard", status: 2 },
        { id: "t2", name: "Validate outcome", status: 3 },
        { id: "t3", name: "Pending step", status: 1 },
      ],
    });
    const provider = createCloudShareGuidedJourneyProvider(client);

    const result = await provider.getParticipantProgress("exp-1", "student-1");

    expect(result).toEqual({
      percentComplete: 67,
      stepsCompleted: 2,
      stepsTotal: 3,
      steps: [
        { stepId: "t1", title: "Explore dashboard", completed: true },
        { stepId: "t2", title: "Validate outcome", completed: true },
        { stepId: "t3", title: "Pending step", completed: false },
      ],
    });
  });

  it("returns null when CloudShare reports no Guided Journey for the experience", async () => {
    const client: CloudShareClient = {
      requestV4: vi
        .fn()
        .mockRejectedValue(
          new CloudShareRequestError("not found", 404, {
            method: "GET",
            path: "/guided-journey/progress/exp-1/student-1",
          }),
        ),
      requestV3: vi.fn(),
    } as unknown as CloudShareClient;
    const provider = createCloudShareGuidedJourneyProvider(client);

    const result = await provider.getParticipantProgress("exp-1", "student-1");
    expect(result).toBeNull();
  });

  it("propagates CloudShare errors (Zod validation or request failures)", async () => {
    const client: CloudShareClient = {
      requestV4: vi.fn().mockRejectedValue(new Error("upstream failure")),
      requestV3: vi.fn(),
    } as unknown as CloudShareClient;
    const provider = createCloudShareGuidedJourneyProvider(client);

    await expect(provider.getParticipantProgress("exp-1", "student-1")).rejects.toThrow("upstream failure");
  });
});
