import { describe, expect, it, vi } from "vitest";
import type { CloudShareClient } from "./client";
import { createCloudShareParticipantLister } from "./participants";

function client(overrides: Partial<CloudShareClient> = {}): CloudShareClient {
  return {
    requestV3: vi.fn(),
    requestV3Text: vi.fn(),
    requestV4: vi.fn(),
    ...overrides,
  } as CloudShareClient;
}

describe("createCloudShareParticipantLister", () => {
  it("lists training participants through the v4 training-students endpoint", async () => {
    const requestV4 = vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) =>
      spec.schema.parse([
        {
          Email: "candidate@helioscx.demo",
          EnvironmentId: "env-1",
          Id: "student-1",
        },
      ]),
    );
    const lister = createCloudShareParticipantLister(client({ requestV4: requestV4 as never }));

    const participants = await lister.listParticipants("training-1");

    expect(requestV4).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/trainings/training-1/students",
      }),
    );
    expect(participants).toEqual([
      {
        email: "candidate@helioscx.demo",
        environmentId: "env-1",
        studentId: "student-1",
      },
    ]);
  });

  it("accepts missing environmentId until login has bound an environment", async () => {
    const requestV4 = vi.fn(async (spec: { schema: { parse(value: unknown): unknown } }) =>
      spec.schema.parse([{ email: "candidate@helioscx.demo" }]),
    );
    const lister = createCloudShareParticipantLister(client({ requestV4: requestV4 as never }));

    await expect(lister.listParticipants("training-1")).resolves.toEqual([
      {
        email: "candidate@helioscx.demo",
        environmentId: null,
        studentId: null,
      },
    ]);
  });
});
