import { describe, expect, it, vi } from "vitest";
import { createCloudShareTrainingRetirementWriter } from "./cohort-experience-retirement";

describe("createCloudShareTrainingRetirementWriter", () => {
  it("returns success when the CloudShare update response confirms the requested end time", async () => {
    const requestV4Detailed = vi.fn().mockImplementationOnce(async (spec) => ({
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
    expect(requestV4Detailed).toHaveBeenCalledTimes(1);
  });

  it("treats a timezone-less CloudShare End value as a UTC confirmation of the requested end time", async () => {
    const requestV4Detailed = vi.fn().mockImplementationOnce(async (spec) => ({
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
    expect(requestV4Detailed).toHaveBeenCalledTimes(1);
  });

  it("performs a readback when the CloudShare update response does not confirm the new end time", async () => {
    const requestV4Detailed = vi
      .fn()
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
      2,
      expect.objectContaining({
        method: "GET",
        path: "/trainings/EXcohort-1",
      }),
    );
  });

  it("throws when CloudShare still does not confirm the requested end after readback", async () => {
    const requestV4Detailed = vi
      .fn()
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
});
