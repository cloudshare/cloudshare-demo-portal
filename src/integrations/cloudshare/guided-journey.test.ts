import { describe, it, expect, vi } from "vitest";
import {
  createCloudShareAggregateGuidedJourneyProvider,
  createCloudShareGuidedJourneyProvider,
} from "./guided-journey";
import type { CloudShareClient } from "./client";
import { CloudShareRequestError, CloudShareResponseError } from "./errors";

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

const liveApiResponse = {
  exploredRate: 0.5,
  inProgressRate: 0.5,
  notStartedRate: 0,
  passedRate: 0.25,
  failedRate: 0.25,
  notInitiatedRate: 0,
  sectionStatuses: [
    {
      number: 0,
      name: "Check pfSense WAN Interface",
      status: "explored",
      isInFocus: false,
      timeSpent: 338.24936349999996,
    },
    {
      number: 0,
      name: "Section Name",
      status: "inProgress",
      isInFocus: false,
      timeSpent: 7.1577779999999995,
    },
    {
      number: 1,
      name: "Check the LAN interface",
      status: "explored",
      isInFocus: false,
      timeSpent: 51.3734852,
    },
    {
      number: 2,
      name: "Section Name 3",
      status: "inProgress",
      isInFocus: false,
      timeSpent: 2.7512976,
    },
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
      { stepId: "t1", title: "Configure routing", completed: true, status: "completed" },
      { stepId: "t2", title: "Create queue", completed: true, status: "completed" },
      { stepId: "t3", title: "Test flow", completed: true, status: "completed" },
      { stepId: "t4", title: "Validate output", completed: false, status: "in progress" },
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

  it("maps the live guided-journey payload with sectionStatuses and raw rates", async () => {
    const client = makeClient(liveApiResponse);
    const provider = createCloudShareGuidedJourneyProvider(client);

    const result = await provider.getParticipantProgress("EX8FegB45PLVmyn8LgPRXPuA2", "PTdBBgMl9ryrQzFBToh3aqew2");

    expect(result).toEqual({
      percentComplete: 50,
      stepsCompleted: 2,
      stepsTotal: 4,
      exploredRate: 0.5,
      inProgressRate: 0.5,
      notStartedRate: 0,
      passedRate: 0.25,
      failedRate: 0.25,
      notInitiatedRate: 0,
      steps: [
        {
          stepId: "0:Check pfSense WAN Interface",
          title: "Check pfSense WAN Interface",
          completed: true,
          status: "explored",
        },
        {
          stepId: "0:Section Name",
          title: "Section Name",
          completed: false,
          status: "in Progress",
        },
        {
          stepId: "1:Check the LAN interface",
          title: "Check the LAN interface",
          completed: true,
          status: "explored",
        },
        {
          stepId: "2:Section Name 3",
          title: "Section Name 3",
          completed: false,
          status: "in Progress",
        },
      ],
    });
  });

  it("preserves the raw Guided Journey payload for diagnostics while keeping normalized progress", async () => {
    const client = makeClient(liveApiResponse);
    const provider = createCloudShareGuidedJourneyProvider(client);

    const result = await provider.getParticipantProgressForDiagnostics(
      "EX8FegB45PLVmyn8LgPRXPuA2",
      "PTdBBgMl9ryrQzFBToh3aqew2",
    );

    expect(result).toEqual({
      progress: {
        percentComplete: 50,
        stepsCompleted: 2,
        stepsTotal: 4,
        exploredRate: 0.5,
        inProgressRate: 0.5,
        notStartedRate: 0,
        passedRate: 0.25,
        failedRate: 0.25,
        notInitiatedRate: 0,
        steps: [
          {
            stepId: "0:Check pfSense WAN Interface",
            title: "Check pfSense WAN Interface",
            completed: true,
            status: "explored",
          },
          {
            stepId: "0:Section Name",
            title: "Section Name",
            completed: false,
            status: "in Progress",
          },
          {
            stepId: "1:Check the LAN interface",
            title: "Check the LAN interface",
            completed: true,
            status: "explored",
          },
          {
            stepId: "2:Section Name 3",
            title: "Section Name 3",
            completed: false,
            status: "in Progress",
          },
        ],
      },
      request: {
        method: "GET",
        path: "/guided-journey/progress/EX8FegB45PLVmyn8LgPRXPuA2/PTdBBgMl9ryrQzFBToh3aqew2",
      },
      response: {
        status: 200,
        body: liveApiResponse,
      },
    });
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
      exploredRate: 0,
      inProgressRate: 0,
      notStartedRate: 0,
      passedRate: 0,
      failedRate: 0,
      notInitiatedRate: 0,
      steps: [
        { stepId: "t1", title: "Explore dashboard", completed: true, status: null },
        { stepId: "t2", title: "Validate outcome", completed: true, status: null },
        { stepId: "t3", title: "Pending step", completed: false, status: null },
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

  it("retains the provider's 404 exchange for participant support diagnostics", async () => {
    const client: CloudShareClient = {
      requestV4: vi.fn().mockRejectedValue(new CloudShareRequestError("not found", 404, {
        method: "GET",
        path: "/guided-journey/progress/exp-1/student-1",
        requestQuery: { include: "sections" },
        responseHeaders: { "x-cloudshare-request": "provider-request-404" },
        responseBody: { error: "not configured", code: "GUIDED_JOURNEY_NOT_FOUND" },
      })),
      requestV3: vi.fn(),
    } as unknown as CloudShareClient;

    await expect(
      createCloudShareGuidedJourneyProvider(client)
        .getParticipantProgressForDiagnostics("exp-1", "student-1"),
    ).resolves.toMatchObject({
      request: { query: { include: "sections" } },
      response: {
        status: 404,
        headers: { "x-cloudshare-request": "provider-request-404" },
        body: { error: "not configured", code: "GUIDED_JOURNEY_NOT_FOUND" },
      },
    });
  });

  it("propagates CloudShare errors (Zod validation or request failures)", async () => {
    const client: CloudShareClient = {
      requestV4: vi.fn().mockRejectedValue(new Error("upstream failure")),
      requestV3: vi.fn(),
    } as unknown as CloudShareClient;
    const provider = createCloudShareGuidedJourneyProvider(client);

    await expect(provider.getParticipantProgress("exp-1", "student-1")).rejects.toThrow("upstream failure");
  });

  it("raises CloudShareResponseError with response details when the diagnostics-aware path gets an unsupported payload", async () => {
    const client = makeClient("not-an-object");
    const provider = createCloudShareGuidedJourneyProvider(client);

    await expect(
      provider.getParticipantProgressForDiagnostics("exp-1", "student-1"),
    ).rejects.toMatchObject({
      name: "CloudShareResponseError",
      context: expect.objectContaining({
        method: "GET",
        path: "/guided-journey/progress/exp-1/student-1",
        integrationSurface: "cloudshare.v4.guided_journey.progress",
        responseBody: JSON.stringify("not-an-object"),
        issues: ["Unsupported Guided Journey progress payload"],
      }),
    });

    await expect(
      provider.getParticipantProgressForDiagnostics("exp-1", "student-1"),
    ).rejects.toBeInstanceOf(CloudShareResponseError);
  });

  it("retains Guided Journey response bodies in unsupported payload diagnostics", async () => {
    const payload = {
      exploredRate: 1.2,
      sectionStatuses: [
        {
          number: 0,
          name: "Broken section",
          status: "explored",
        },
      ],
      passphrase: "candidate-visible-passphrase",
      loginUrl: "https://use.cloudshare.com/Ent/Login.aspx?token=admin-evidence",
      apiKey: "secret-api-key",
      authorization: "Bearer secret-bearer-token",
    };
    const client = makeClient(payload);
    const provider = createCloudShareGuidedJourneyProvider(client);

    await expect(
      provider.getParticipantProgressForDiagnostics("exp-1", "student-1"),
    ).rejects.toMatchObject({
      name: "CloudShareResponseError",
      context: expect.objectContaining({
        responseBody: JSON.stringify({
          exploredRate: 1.2,
          sectionStatuses: [
            {
              number: 0,
              name: "Broken section",
              status: "explored",
            },
          ],
          passphrase: "candidate-visible-passphrase",
          loginUrl: "https://use.cloudshare.com/Ent/Login.aspx?token=admin-evidence",
          apiKey: "secret-api-key",
          authorization: "Bearer secret-bearer-token",
        }),
      }),
    });
  });

  it("raises CloudShareResponseError with validation issues when a recognized payload has a rate above 1", async () => {
    const payload = {
      exploredRate: 1.2,
      sectionStatuses: [
        {
          number: 0,
          name: "Check pfSense WAN Interface",
          status: "explored",
        },
      ],
    };
    const client = makeClient(payload);
    const provider = createCloudShareGuidedJourneyProvider(client);

    await expect(
      provider.getParticipantProgressForDiagnostics("exp-1", "student-1"),
    ).rejects.toMatchObject({
      name: "CloudShareResponseError",
      context: expect.objectContaining({
        responseBody: JSON.stringify(payload),
        issues: expect.arrayContaining(["Number must be less than or equal to 1"]),
      }),
    });
  });

  it("raises CloudShareResponseError with validation issues when completed steps exceed total steps", async () => {
    const payload = {
      progressRate: 50,
      completedSections: 2,
      totalSections: 1,
      sections: [
        { id: "t1", name: "Configure routing", status: "completed" },
      ],
    };
    const client = makeClient(payload);
    const provider = createCloudShareGuidedJourneyProvider(client);

    await expect(
      provider.getParticipantProgressForDiagnostics("exp-1", "student-1"),
    ).rejects.toMatchObject({
      name: "CloudShareResponseError",
      context: expect.objectContaining({
        responseBody: JSON.stringify(payload),
        issues: expect.arrayContaining(["stepsCompleted must not exceed stepsTotal"]),
      }),
    });
  });
});

describe("createCloudShareAggregateGuidedJourneyProvider", () => {
  it("maps aggregate Guided Journey progress for a shared Experience", async () => {
    const client = makeClient({
      avgExploredRate: 0.3,
      avgInProgressRate: 0.2,
      avgNotStartedRate: 0.1,
      avgPassedRate: 0.25,
      avgFailedRate: 0.05,
      avgNotInitiatedRate: 0.1,
      aggSectionStatuses: [
        {
          number: 0,
          name: "Check pfSense WAN Interface",
          status: "explored",
          avgExploredRate: 0.5,
          avgInProgressRate: 0.3,
          avgNotStartedRate: 0.2,
          avgPassedRate: 0.4,
          avgFailedRate: 0.1,
          avgNotInitiatedRate: 0,
          avgTimeSpent: 338.24936349999996,
        },
        {
          number: 1,
          name: "Check the LAN interface",
          status: "inProgress",
          avgExploredRate: 0.2,
          avgInProgressRate: 0.4,
          avgNotStartedRate: 0.4,
          avgPassedRate: 0.1,
          avgFailedRate: 0.2,
          avgNotInitiatedRate: 0.3,
          avgTimeSpent: 51.3734852,
        },
      ],
    });

    const provider = createCloudShareAggregateGuidedJourneyProvider(client);

    const result = await provider.getAggregateProgress("EXcohort-1");

    expect(result).toEqual({
      avgExploredRate: 0.3,
      avgInProgressRate: 0.2,
      avgNotStartedRate: 0.1,
      avgPassedRate: 0.25,
      avgFailedRate: 0.05,
      avgNotInitiatedRate: 0.1,
      aggSectionStatuses: [
        {
          sectionNumber: 0,
          title: "Check pfSense WAN Interface",
          status: "explored",
          avgExploredRate: 0.5,
          avgInProgressRate: 0.3,
          avgNotStartedRate: 0.2,
          avgPassedRate: 0.4,
          avgFailedRate: 0.1,
          avgNotInitiatedRate: 0,
          avgTimeSpentSeconds: 338.24936349999996,
        },
        {
          sectionNumber: 1,
          title: "Check the LAN interface",
          status: "in Progress",
          avgExploredRate: 0.2,
          avgInProgressRate: 0.4,
          avgNotStartedRate: 0.4,
          avgPassedRate: 0.1,
          avgFailedRate: 0.2,
          avgNotInitiatedRate: 0.3,
          avgTimeSpentSeconds: 51.3734852,
        },
      ],
    });
    expect(client.requestV4).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/guided-journey/progress/EXcohort-1",
      }),
    );
  });

  it("returns null when CloudShare reports no aggregate Guided Journey progress for the Experience", async () => {
    const client: CloudShareClient = {
      requestV4: vi
        .fn()
        .mockRejectedValue(
          new CloudShareRequestError("not found", 404, {
            method: "GET",
            path: "/guided-journey/progress/EXcohort-1",
          }),
        ),
      requestV3: vi.fn(),
    } as unknown as CloudShareClient;

    const provider = createCloudShareAggregateGuidedJourneyProvider(client);

    await expect(provider.getAggregateProgress("EXcohort-1")).resolves.toBeNull();
  });

  it("raises CloudShareResponseError when the aggregate payload is unsupported", async () => {
    const client = makeClient({
      avgExploredRate: 0.3,
      aggSectionStatuses: "not-an-array",
    });

    const provider = createCloudShareAggregateGuidedJourneyProvider(client);

    await expect(provider.getAggregateProgress("EXcohort-1")).rejects.toMatchObject({
      name: "CloudShareResponseError",
      context: expect.objectContaining({
        path: "/guided-journey/progress/EXcohort-1",
        integrationSurface: "cloudshare.v4.guided_journey.progress.aggregate",
      }),
    });
  });

  it("raises CloudShareResponseError when an aggregate section row is malformed", async () => {
    const client = makeClient({
      avgExploredRate: 0.3,
      avgInProgressRate: 0.2,
      avgNotStartedRate: 0.1,
      avgPassedRate: 0.25,
      avgFailedRate: 0.05,
      avgNotInitiatedRate: 0.1,
      aggSectionStatuses: [
        {
          number: 0,
          status: "explored",
          avgExploredRate: 0.5,
          avgInProgressRate: 0.3,
          avgNotStartedRate: 0.2,
          avgPassedRate: 0.4,
          avgFailedRate: 0.1,
          avgNotInitiatedRate: 0,
        },
      ],
    });

    const provider = createCloudShareAggregateGuidedJourneyProvider(client);

    await expect(provider.getAggregateProgress("EXcohort-1")).rejects.toMatchObject({
      name: "CloudShareResponseError",
      context: expect.objectContaining({
        path: "/guided-journey/progress/EXcohort-1",
        integrationSurface: "cloudshare.v4.guided_journey.progress.aggregate",
        issues: ["Unsupported aggregate Guided Journey progress payload"],
      }),
    });
  });
});
