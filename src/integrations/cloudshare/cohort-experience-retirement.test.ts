import { describe, expect, it, vi } from "vitest";
import { createCloudShareTrainingRetirementWriter } from "./cohort-experience-retirement";

describe("createCloudShareTrainingRetirementWriter", () => {
  it("returns success when the CloudShare update response confirms the requested end time", async () => {
    const requestV4Detailed = vi
      .fn()
      .mockImplementationOnce(trainingReadback)
      .mockImplementationOnce(async (spec) => ({
        data: spec.schema.parse({
          id: "EXcohort-1",
          End: "2026-07-05T10:00:00.000Z",
        }),
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training.update",
        request: { method: spec.method, path: `/v4${spec.path}`, body: spec.body },
        response: {
          status: 200,
          body: {
            id: "EXcohort-1",
            End: "2026-07-05T10:00:00.000Z",
          },
        },
      }));
    const writer = createCloudShareTrainingRetirementWriter({
      requestV4Detailed,
    } as never);

    const result = await writer.retireTrainingToEnd({
      trainingId: "EXcohort-1",
      end: new Date("2026-07-05T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      trainingId: "EXcohort-1",
      end: "2026-07-05T10:00:00.000Z",
      integrationSurface: "cloudshare.v4.training.update",
    });
    expect(requestV4Detailed).toHaveBeenCalledTimes(2);
    expect(requestV4Detailed).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "PUT",
        path: "/trainings/EXcohort-1",
        body: expect.objectContaining({
          Name: "Retirement Smoke Cohort",
          Start: "2026-07-05T09:00:00",
          End: "2026-07-05T10:00:00.000Z",
          Type: "selfPaced",
          TeamId: "team-1",
          PolicyId: "policy-1",
          TimeZone: "UTC",
          ProjectId: "project-1",
          Passphrase: "certalis-cohort",
          MaxStudents: 20,
          BlueprintIds: ["blueprint-1"],
          MainInstructor: { Email: "instructor@example.com" },
          UsersEarlyAccess: { GrantEarlyAccess: 2 },
          CloudshareRegionIds: ["region-1"],
        }),
      }),
    );
  });

  it("treats a timezone-less CloudShare End value as a UTC confirmation of the requested end time", async () => {
    const requestV4Detailed = vi
      .fn()
      .mockImplementationOnce(trainingReadback)
      .mockImplementationOnce(async (spec) => ({
        data: spec.schema.parse({
          id: "EXcohort-1",
          End: "2026-07-05T10:00:00",
        }),
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training.update",
        request: { method: spec.method, path: `/v4${spec.path}`, body: spec.body },
        response: {
          status: 200,
          body: {
            id: "EXcohort-1",
            End: "2026-07-05T10:00:00",
          },
        },
      }));
    const writer = createCloudShareTrainingRetirementWriter({
      requestV4Detailed,
    } as never);

    const result = await writer.retireTrainingToEnd({
      trainingId: "EXcohort-1",
      end: new Date("2026-07-05T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      trainingId: "EXcohort-1",
      end: "2026-07-05T10:00:00",
      integrationSurface: "cloudshare.v4.training.update",
    });
    expect(requestV4Detailed).toHaveBeenCalledTimes(2);
  });

  it("performs a readback when the CloudShare update response does not confirm the new end time", async () => {
    const requestV4Detailed = vi
      .fn()
      .mockImplementationOnce(trainingReadback)
      .mockImplementationOnce(async (spec) => ({
        data: spec.schema.parse({
          id: "EXcohort-1",
        }),
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training.update",
        request: { method: spec.method, path: `/v4${spec.path}`, body: spec.body },
        response: {
          status: 200,
          body: {
            id: "EXcohort-1",
          },
        },
      }))
      .mockImplementationOnce(async (spec) => ({
        data: spec.schema.parse({
          id: "EXcohort-1",
          End: "2026-07-05T10:00:00.000Z",
        }),
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training.detail",
        request: { method: spec.method, path: `/v4${spec.path}` },
        response: {
          status: 200,
          body: {
            id: "EXcohort-1",
            End: "2026-07-05T10:00:00.000Z",
          },
        },
      }));
    const writer = createCloudShareTrainingRetirementWriter({
      requestV4Detailed,
    } as never);

    const result = await writer.retireTrainingToEnd({
      trainingId: "EXcohort-1",
      end: new Date("2026-07-05T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      trainingId: "EXcohort-1",
      end: "2026-07-05T10:00:00.000Z",
      integrationSurface: "cloudshare.v4.training.update",
    });
    expect(requestV4Detailed).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        method: "GET",
        path: "/trainings/EXcohort-1",
      }),
    );
  });

  it("throws when CloudShare still does not confirm the requested end after readback", async () => {
    const requestV4Detailed = vi
      .fn()
      .mockImplementationOnce(trainingReadback)
      .mockImplementationOnce(async (spec) => ({
        data: spec.schema.parse({
          id: "EXcohort-1",
        }),
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training.update",
        request: { method: spec.method, path: `/v4${spec.path}`, body: spec.body },
        response: {
          status: 200,
          body: {
            id: "EXcohort-1",
          },
        },
      }))
      .mockImplementationOnce(async (spec) => ({
        data: spec.schema.parse({
          id: "EXcohort-1",
          End: "2026-07-06T10:15:00.000Z",
        }),
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training.detail",
        request: { method: spec.method, path: `/v4${spec.path}` },
        response: {
          status: 200,
          body: {
            id: "EXcohort-1",
            End: "2026-07-06T10:15:00.000Z",
          },
        },
      }));
    const writer = createCloudShareTrainingRetirementWriter({
      requestV4Detailed,
    } as never);

    await expect(
      writer.retireTrainingToEnd({
        trainingId: "EXcohort-1",
        end: new Date("2026-07-05T10:00:00.000Z"),
      }),
    ).rejects.toMatchObject({
      name: "CloudShareResponseError",
      message: "CloudShare did not confirm the Cohort Exam Session retirement end time.",
      context: {
        integrationSurface: "cloudshare.v4.training.update",
        cause: "retire_training_end_unconfirmed",
        expectedEnd: "2026-07-05T10:00:00.000Z",
        confirmedEnd: "2026-07-06T10:15:00.000Z",
      },
    });
  });

  it("throws when a timezone-less CloudShare End still points to a genuinely different instant", async () => {
    const requestV4Detailed = vi
      .fn()
      .mockImplementationOnce(trainingReadback)
      .mockImplementationOnce(async (spec) => ({
        data: spec.schema.parse({
          id: "EXcohort-1",
          End: "2026-07-05T10:01:30",
        }),
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training.update",
        request: { method: spec.method, path: `/v4${spec.path}`, body: spec.body },
        response: {
          status: 200,
          body: {
            id: "EXcohort-1",
            End: "2026-07-05T10:01:30",
          },
        },
      }))
      .mockImplementationOnce(async (spec) => ({
        data: spec.schema.parse({
          id: "EXcohort-1",
          End: "2026-07-05T10:01:30",
        }),
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training.detail",
        request: { method: spec.method, path: `/v4${spec.path}` },
        response: {
          status: 200,
          body: {
            id: "EXcohort-1",
            End: "2026-07-05T10:01:30",
          },
        },
      }));
    const writer = createCloudShareTrainingRetirementWriter({
      requestV4Detailed,
    } as never);

    await expect(
      writer.retireTrainingToEnd({
        trainingId: "EXcohort-1",
        end: new Date("2026-07-05T10:00:00.000Z"),
      }),
    ).rejects.toMatchObject({
      name: "CloudShareResponseError",
      context: {
        expectedEnd: "2026-07-05T10:00:00.000Z",
        confirmedEnd: "2026-07-05T10:01:30",
      },
    });
  });

  it("normalizes lower-camel CloudShare readback fields into the full PascalCase PUT body", async () => {
    const requestV4Detailed = vi
      .fn()
      .mockImplementationOnce(async (spec) => ({
        data: spec.schema.parse({
          id: "EXcohort-1",
          name: "Retirement Smoke Cohort",
          start: "2026-07-05T09:00:00",
          end: "2026-07-05T11:00:00",
          type: "selfPaced",
          teamId: "team-1",
          policyId: "policy-1",
          timeZone: "UTC",
          projectId: "project-1",
          passphrase: "certalis-cohort",
          maxStudents: 20,
          blueprintIds: ["blueprint-1"],
          mainInstructor: { email: "instructor@example.com" },
          usersEarlyAccess: { grantEarlyAccess: 2 },
          cloudshareRegionIds: ["region-1"],
          registrationType: "registeredStudentsOnly",
        }),
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training.detail",
        request: { method: spec.method, path: `/v4${spec.path}` },
        response: {
          status: 200,
          body: {
            id: "EXcohort-1",
            name: "Retirement Smoke Cohort",
          },
        },
      }))
      .mockImplementationOnce(async (spec) => ({
        data: spec.schema.parse({
          id: "EXcohort-1",
          End: "2026-07-05T10:00:00.000Z",
        }),
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training.update",
        request: { method: spec.method, path: `/v4${spec.path}`, body: spec.body },
        response: {
          status: 200,
          body: {
            id: "EXcohort-1",
            End: "2026-07-05T10:00:00.000Z",
          },
        },
      }));
    const writer = createCloudShareTrainingRetirementWriter({
      requestV4Detailed,
    } as never);

    await writer.retireTrainingToEnd({
      trainingId: "EXcohort-1",
      end: new Date("2026-07-05T10:00:00.000Z"),
    });

    expect(requestV4Detailed).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "PUT",
        body: expect.objectContaining({
          Name: "Retirement Smoke Cohort",
          Start: "2026-07-05T09:00:00",
          End: "2026-07-05T10:00:00.000Z",
          Type: "selfPaced",
          TeamId: "team-1",
          PolicyId: "policy-1",
          TimeZone: "UTC",
          ProjectId: "project-1",
          Passphrase: "certalis-cohort",
          MaxStudents: 20,
          BlueprintIds: ["blueprint-1"],
          MainInstructor: { Email: "instructor@example.com" },
          UsersEarlyAccess: { GrantEarlyAccess: 2 },
          CloudshareRegionIds: ["region-1"],
          RegistrationType: "registeredStudentsOnly",
        }),
      }),
    );
  });
});

async function trainingReadback(spec: {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
  readonly schema: { parse(payload: unknown): unknown };
}) {
  return {
    data: spec.schema.parse({
      id: "EXcohort-1",
      Name: "Retirement Smoke Cohort",
      Start: "2026-07-05T09:00:00",
      End: "2026-07-05T11:00:00",
      Type: "selfPaced",
      TeamId: "team-1",
      PolicyId: "policy-1",
      TimeZone: "UTC",
      ProjectId: "project-1",
      Passphrase: "certalis-cohort",
      MaxStudents: 20,
      BlueprintIds: ["blueprint-1"],
      MainInstructor: { Email: "instructor@example.com" },
      UsersEarlyAccess: { GrantEarlyAccess: 2 },
      CloudshareRegionIds: ["region-1"],
      RegistrationType: "registeredStudentsOnly",
    }),
    host: "api.accelerate.cloudshare.com",
    integrationSurface: "cloudshare.v4.training.detail",
    request: { method: spec.method, path: `/v4${spec.path}` },
    response: {
      status: 200,
      body: {
        id: "EXcohort-1",
        Name: "Retirement Smoke Cohort",
      },
    },
  };
}
