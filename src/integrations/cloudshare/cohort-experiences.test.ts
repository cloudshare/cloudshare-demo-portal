import { describe, expect, it, vi } from "vitest";
import { createCloudShareOnDemandExperienceCreator } from "./cohort-experiences";
import type { CloudShareClient } from "./client";
import { CloudShareResponseError } from "./errors";

describe("cloudShareOnDemandExperienceCreator", () => {
  it("creates a self-paced training with inherited Exam resource tuple", async () => {
    const requestV3 = vi.fn(async (spec: { schema: { parse(value: unknown): unknown } }) =>
      spec.schema.parse({
        rows: [{ id: "TM-team-1", name: "Helios Team" }],
      }),
    );
    const requestV4Detailed = vi.fn(
      async (spec: { method: string; path: string; body: Record<string, unknown>; schema: { parse(value: unknown): unknown } }) => ({
        data: spec.schema.parse({ id: "EXcohort-1" }),
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training",
        request: { method: spec.method, path: spec.path, body: spec.body },
        response: { status: 201, body: { id: "EXcohort-1" } },
      }),
    );
    const creator = createCloudShareOnDemandExperienceCreator({
      requestV3,
      requestV4Detailed,
    } as unknown as CloudShareClient);

    const result = await creator.createOnDemandExperience({
      name: "Helios CloudShare Fundamentals - July Admin Cohort",
      startsAt: new Date("2026-07-05T09:00:00.000Z"),
      endsAt: new Date("2026-07-31T17:00:00.000Z"),
      projectId: "project-1",
      blueprintId: "bp-1",
      policyId: "policy-1",
      regionIds: ["region-1", "region-2"],
      instructorId: "instructor-1",
      timeZoneId: "UTC",
      passphrase: "certalis-cohort-session-1",
      externalId: "0d379db9-6b08-4457-b863-eb5f45323d24",
    });

    expect(requestV3).toHaveBeenCalledWith({
      method: "GET",
      path: "/teams",
      query: {
        getRows: "true",
        projectId: "project-1",
        sortBy: "name",
        sortAscending: "true",
        skip: "0",
        take: "20",
      },
      schema: expect.anything(),
    });
    expect(requestV4Detailed).toHaveBeenCalledWith({
      method: "POST",
      path: "/trainings",
      body: {
        Name: "Helios CloudShare Fundamentals - July Admin Cohort",
        Start: "2026-07-05T09:00:00.000Z",
        End: "2026-07-31T17:00:00.000Z",
        Type: "selfPaced",
        ProjectId: "project-1",
        TeamId: "TM-team-1",
        BlueprintIds: ["bp-1"],
        PolicyId: "policy-1",
        CloudshareRegionIds: ["region-1", "region-2"],
        MainInstructor: { Email: "instructor-1" },
        TimeZone: "UTC",
        Passphrase: "certalis-cohort-session-1",
        ExternalId: "0d379db96b084457b863eb5f45323d24",
        RegistrationType: "registeredStudentsOnly",
        UsersEarlyAccess: { GrantEarlyAccess: 2 },
      },
      schema: expect.anything(),
    });
    expect(result).toMatchObject({
      trainingId: "EXcohort-1",
      experienceId: "EXcohort-1",
      teamId: "TM-team-1",
      teamCount: 1,
      integrationSurface: "cloudshare.v4.training",
    });
  });

  it("omits End when the Cohort Exam Session has no admission close", async () => {
    const requestV3 = vi.fn(async (spec: { schema: { parse(value: unknown): unknown } }) =>
      spec.schema.parse({ rows: [{ id: "TM-team-1", name: "Helios Team" }] }),
    );
    const requestV4Detailed = vi.fn(
      async (spec: { method: string; path: string; body: Record<string, unknown>; schema: { parse(value: unknown): unknown } }) => ({
        data: spec.schema.parse({ id: "EXcohort-1" }),
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training",
        request: { method: spec.method, path: spec.path, body: spec.body },
        response: { status: 201, body: { id: "EXcohort-1" } },
      }),
    );
    const creator = createCloudShareOnDemandExperienceCreator({
      requestV3,
      requestV4Detailed,
    } as unknown as CloudShareClient);

    await creator.createOnDemandExperience({
      name: "Open Cohort",
      startsAt: new Date("2026-07-05T09:00:00.000Z"),
      endsAt: null,
      projectId: "project-1",
      blueprintId: "bp-1",
      policyId: "policy-1",
      regionIds: ["region-1"],
      instructorId: "instructor-1",
      timeZoneId: "UTC",
      passphrase: "certalis-cohort-session-1",
    });

    expect(requestV4Detailed.mock.calls[0][0].body).not.toHaveProperty("End");
  });

  it("raises a typed response error when no Project Team can be resolved", async () => {
    const requestV3 = vi.fn(async (spec: { schema: { parse(value: unknown): unknown } }) =>
      spec.schema.parse({ rows: [] }),
    );
    const requestV4Detailed = vi.fn();
    const creator = createCloudShareOnDemandExperienceCreator({
      requestV3,
      requestV4Detailed,
    } as unknown as CloudShareClient);

    const create = creator.createOnDemandExperience({
      name: "Open Cohort",
      startsAt: new Date("2026-07-05T09:00:00.000Z"),
      endsAt: null,
      projectId: "project-1",
      blueprintId: "bp-1",
      policyId: "policy-1",
      regionIds: ["region-1"],
      instructorId: "instructor-1",
      timeZoneId: "UTC",
      passphrase: "certalis-cohort-session-1",
    });

    await expect(create).rejects.toMatchObject({
      name: "CloudShareResponseError",
      context: {
        method: "GET",
        path: "/teams",
        integrationSurface: "cloudshare.v3.teams",
        requestQuery: { projectId: "project-1" },
        responseBody: { teamCount: 0 },
      },
    });
    await expect(create).rejects.toBeInstanceOf(CloudShareResponseError);
    expect(requestV4Detailed).not.toHaveBeenCalled();
  });
});
