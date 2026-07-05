import { describe, expect, it, vi } from "vitest";
import type { CloudShareClient } from "./client";
import {
  createCloudShareParticipantLister,
  isCloudShareTrainingExperienceId,
  normalizeTrainingParticipants,
} from "./participants";

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

    const participants = await lister.listParticipants("EXtraining-1");

    expect(requestV4).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/trainings/EXtraining-1/students",
      }),
    );
    expect(participants).toEqual([
      {
        email: "candidate@helioscx.demo",
        environmentId: "env-1",
        environmentStatus: null,
        participationStatus: null,
        firstJoinedAt: null,
        firstName: null,
        lastName: null,
        displayName: null,
        studentId: "student-1",
      },
    ]);
  });

  it("accepts missing environmentId until login has bound an environment", async () => {
    const requestV4 = vi.fn(async (spec: { schema: { parse(value: unknown): unknown } }) =>
      spec.schema.parse([{ email: "candidate@helioscx.demo" }]),
    );
    const lister = createCloudShareParticipantLister(client({ requestV4: requestV4 as never }));

    await expect(lister.listParticipants("EXtraining-1")).resolves.toEqual([
      {
        email: "candidate@helioscx.demo",
        environmentId: null,
        environmentStatus: null,
        participationStatus: null,
        firstJoinedAt: null,
        firstName: null,
        lastName: null,
        displayName: null,
        studentId: null,
      },
    ]);
  });

  it("does not send local placeholder training IDs to CloudShare", async () => {
    const requestV4 = vi.fn();
    const lister = createCloudShareParticipantLister(client({ requestV4: requestV4 as never }));

    await expect(lister.listParticipants("codex-training")).resolves.toEqual([]);

    expect(requestV4).not.toHaveBeenCalled();
  });

  it("recognizes CloudShare training experience IDs by the EX prefix", () => {
    expect(isCloudShareTrainingExperienceId("EXGPrh8JCEep6W7sfOLOEmRQ2")).toBe(true);
    expect(isCloudShareTrainingExperienceId("codex-training")).toBe(false);
    expect(isCloudShareTrainingExperienceId("PRCU02uuokHPBfjMedkmradg2")).toBe(false);
  });

  it("accepts wrapped rows and nested user/environment fields", () => {
    expect(
      normalizeTrainingParticipants({
        rows: [
          {
            User: { Email: "candidate@helioscx.demo", Id: "user-1" },
            Environment: { Id: "env-1" },
          },
        ],
      }),
    ).toEqual([
      {
        email: "candidate@helioscx.demo",
        environmentId: "env-1",
        environmentStatus: null,
        participationStatus: null,
        firstJoinedAt: null,
        firstName: null,
        lastName: null,
        displayName: null,
        studentId: "user-1",
      },
    ]);
  });

  it("accepts the live wrapped response shape with envId and monitoring identity fields", () => {
    expect(
      normalizeTrainingParticipants({
        count: 1,
        items: [
          {
            email: "candidate@helioscx.demo",
            firstName: "Casey",
            lastName: "Rivera",
            name: "Casey Rivera",
            envStatus: "ready",
            participationStatus: "inProgress",
            envId: "ENVS2n38LTNdcC4sHsqnjRzg2",
            firstJoined: "2026-07-06T10:15:00.000Z",
          },
        ],
      }),
    ).toEqual([
      {
        email: "candidate@helioscx.demo",
        environmentId: "ENVS2n38LTNdcC4sHsqnjRzg2",
        environmentStatus: "ready",
        participationStatus: "inProgress",
        firstJoinedAt: "2026-07-06T10:15:00.000Z",
        firstName: "Casey",
        lastName: "Rivera",
        displayName: "Casey Rivera",
        studentId: null,
      },
    ]);
  });

  it("skips irrelevant rows that have no usable email instead of failing the whole response", () => {
    expect(
      normalizeTrainingParticipants({
        Students: [
          { Id: "student-missing-email", EnvironmentId: "env-unused" },
          { student: { email: "candidate@helioscx.demo", id: "student-1" } },
        ],
      }),
    ).toEqual([
      {
        email: "candidate@helioscx.demo",
        environmentId: null,
        environmentStatus: null,
        participationStatus: null,
        firstJoinedAt: null,
        firstName: null,
        lastName: null,
        displayName: null,
        studentId: "student-1",
      },
    ]);
  });

  it("normalizes alternate casing for participant identity and firstJoined fields", () => {
    expect(
      normalizeTrainingParticipants({
        Students: [
          {
            User: {
              Email: "candidate@helioscx.demo",
              FirstName: "Jordan",
              LastName: "Lee",
              Name: "Jordan Lee",
              Id: "student-1",
            },
            Environment: {
              Id: "env-1",
              Status: "Suspended",
            },
            ParticipationStatus: "completed",
            FirstJoined: "2026-07-06T09:00:00.000Z",
          },
        ],
      }),
    ).toEqual([
      {
        email: "candidate@helioscx.demo",
        environmentId: "env-1",
        environmentStatus: "Suspended",
        participationStatus: "completed",
        firstJoinedAt: "2026-07-06T09:00:00.000Z",
        firstName: "Jordan",
        lastName: "Lee",
        displayName: "Jordan Lee",
        studentId: "student-1",
      },
    ]);
  });
});
