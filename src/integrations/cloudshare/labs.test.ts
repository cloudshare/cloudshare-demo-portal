import { describe, it, expect, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { createCloudShareLabProvisioner } from "./labs";
import { createCloudShareClient } from "./client";
import { createFixtureHttpClient, loadFixturesFromDir } from "./fixtures";
import type { CloudShareClient } from "./client";
import type { V4TokenProvider } from "./v4-auth";

describe("cloudShareLabProvisioner — request shape", () => {
  it("creates a training with instructorLed timing and exam provisioning tuple", async () => {
    const requestV3 = vi.fn(async (spec: { schema: { parse(value: unknown): unknown } }) =>
      spec.schema.parse({
        rows: [{ id: "TM-team-1", name: "Helios Team" }],
      }),
    );
    const requestV4Detailed = vi.fn(
      async (spec: { method: string; path: string; body: Record<string, unknown>; schema: { parse(value: unknown): unknown } }) => ({
        data: spec.schema.parse({ id: "exp-1" }),
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training",
        request: { method: spec.method, path: spec.path, body: spec.body },
        response: { status: 200, body: { id: "exp-1" } },
      }),
    );
    const client = { requestV4Detailed, requestV4: vi.fn(), requestV3 } as unknown as CloudShareClient;
    const labs = createCloudShareLabProvisioner(client);

    const result = await labs.createTraining!({
      title: "Exam GCP-ASSOC",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      endsAt: new Date("2026-06-15T17:30:00.000Z"),
      projectId: "project-1",
      blueprintId: "bp-1",
      policyId: "policy-1",
      regionIds: ["region-1", "region-2"],
      instructorId: "instructor@example.com",
      passphrase: "certalis-attempt-1",
      timeZoneId: "UTC",
      externalId: "0d379db9-6b08-4457-b863-eb5f45323d24",
    });

    expect(result).toEqual({
      trainingId: "exp-1",
      teamId: "TM-team-1",
      teamCount: 1,
      integrationSurface: "cloudshare.v4.training",
      request: {
        method: "POST",
        path: "/trainings",
        body: {
          Name: "Exam GCP-ASSOC",
          Start: "2026-06-15T16:00:00.000Z",
          End: "2026-06-15T17:30:00.000Z",
          Type: "instructorLed",
          ProjectId: "project-1",
          TeamId: "TM-team-1",
          BlueprintIds: ["bp-1"],
          PolicyId: "policy-1",
          CloudshareRegionIds: ["region-1", "region-2"],
          MainInstructor: { Email: "instructor@example.com" },
          TimeZone: "UTC",
          Passphrase: "certalis-attempt-1",
          ExternalId: "0d379db96b084457b863eb5f45323d24",
          UsersEarlyAccess: { GrantEarlyAccess: 2 },
        },
      },
      response: {
        status: 200,
        body: { id: "exp-1" },
      },
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
    const spec = requestV4Detailed.mock.calls[0][0] as unknown as {
      method: string;
      path: string;
      body: Record<string, unknown>;
    };
    expect(spec.method).toBe("POST");
    expect(spec.path).toBe("/trainings");
    expect(spec.body).toEqual({
      Name: "Exam GCP-ASSOC",
      Start: "2026-06-15T16:00:00.000Z",
      End: "2026-06-15T17:30:00.000Z",
      Type: "instructorLed",
      ProjectId: "project-1",
      TeamId: "TM-team-1",
      BlueprintIds: ["bp-1"],
      PolicyId: "policy-1",
      CloudshareRegionIds: ["region-1", "region-2"],
      MainInstructor: { Email: "instructor@example.com" },
      TimeZone: "UTC",
      Passphrase: "certalis-attempt-1",
      ExternalId: "0d379db96b084457b863eb5f45323d24",
      UsersEarlyAccess: { GrantEarlyAccess: 2 },
    });
  });

  it("targets the training-scoped participant and sponsored-link paths", async () => {
    const requestV4Detailed = vi.fn(async (spec: { method: string; path: string; body?: unknown; schema: { parse(value: unknown): unknown } }) =>
      spec.path.endsWith("/sponsored-link")
        ? {
            data: spec.schema.parse({ loginUrl: "https://classic.cloudshare.com/login?t=x" }),
            host: "api.accelerate.cloudshare.com",
            integrationSurface: "cloudshare.v4.training.sponsored_link",
            request: { method: spec.method, path: spec.path, body: spec.body },
            response: {
              status: 200,
              body: { loginUrl: "https://classic.cloudshare.com/login?t=x" },
            },
          }
        : {
            data: spec.schema.parse([
              {
                email: "candidate@helioscx.demo",
                firstName: "Candidate",
                lastName: "Demo",
              },
            ]),
            host: "api.accelerate.cloudshare.com",
            integrationSurface: "cloudshare.v4.training.participant",
            request: { method: spec.method, path: spec.path, body: spec.body },
            response: {
              status: 200,
              body: [
                {
                  email: "candidate@helioscx.demo",
                  firstName: "Candidate",
                  lastName: "Demo",
                },
              ],
            },
          },
    );
    const client = {
      requestV4Detailed,
      requestV4: vi.fn(),
      requestV3: vi.fn(),
    } as unknown as CloudShareClient;
    const labs = createCloudShareLabProvisioner(client);

    await labs.addParticipant!({
      trainingId: "training-1",
      email: "candidate@helioscx.demo",
      firstName: "Candidate",
      lastName: "Demo",
    });
    const link = await labs.createSponsoredLink({
      trainingId: "training-1",
      email: "candidate@helioscx.demo",
      firstName: "Candidate",
      lastName: "Demo",
    });

    expect(requestV4Detailed.mock.calls[0][0].path).toBe("/trainings/training-1/students");
    expect(requestV4Detailed.mock.calls[0][0].body).toEqual([
      {
        email: "candidate@helioscx.demo",
        firstName: "Candidate",
        lastName: "Demo",
      },
    ]);
    expect(requestV4Detailed.mock.calls[1][0].path).toBe("/trainings/training-1/sponsored-link");
    expect(requestV4Detailed.mock.calls[1][0].body).toEqual({
      email: "candidate@helioscx.demo",
      firstName: "Candidate",
      lastName: "Demo",
    });
    expect(link.loginUrl).toContain("classic.cloudshare.com");
  });

  it("writes explicit Certalis participant correlation properties and returns the CloudShare participant ID when available", async () => {
    const requestV4Detailed = vi.fn(async (spec: { method: string; path: string; body?: unknown; schema: { parse(value: unknown): unknown } }) =>
      spec.path.endsWith("/students")
        ? {
            data: spec.schema.parse([
              {
                id: "student-1",
                email: "candidate@helioscx.demo",
              },
            ]),
            host: "api.accelerate.cloudshare.com",
            integrationSurface: "cloudshare.v4.training.participant",
            request: { method: spec.method, path: spec.path, body: spec.body },
            response: {
              status: 200,
              body: [
                {
                  id: "student-1",
                  email: "candidate@helioscx.demo",
                },
              ],
            },
          }
        : {
            data: spec.schema.parse({ loginUrl: "https://classic.cloudshare.com/login?t=x" }),
            host: "api.accelerate.cloudshare.com",
            integrationSurface: "cloudshare.v4.training.sponsored_link",
            request: { method: spec.method, path: spec.path, body: spec.body },
            response: {
              status: 200,
              body: { loginUrl: "https://classic.cloudshare.com/login?t=x" },
            },
          },
    );
    const client = {
      requestV4Detailed,
      requestV4: vi.fn(),
      requestV3: vi.fn(),
    } as unknown as CloudShareClient;
    const labs = createCloudShareLabProvisioner(client);

    const result = await labs.addParticipant!({
      trainingId: "training-1",
      email: "candidate@helioscx.demo",
      firstName: "Candidate",
      lastName: "Demo",
      certalisExamAttemptId: "attempt-1",
      certalisCandidateId: "candidate-1",
    });

    expect(requestV4Detailed.mock.calls[0][0].body).toEqual([
      {
        email: "candidate@helioscx.demo",
        firstName: "Candidate",
        lastName: "Demo",
        customProperties: [
          { Name: "certalisExamAttemptId", Value: "attempt-1" },
          { Name: "certalisCandidateId", Value: "candidate-1" },
        ],
      },
    ]);
    expect(result).toMatchObject({
      participantId: "student-1",
      response: {
        status: 200,
      },
    });
  });

  it("reads training start state with diagnostics before cohort joins", async () => {
    const requestV4Detailed = vi.fn(
      async (spec: { method: string; path: string; schema: { parse(value: unknown): unknown } }) => {
        const raw = {
          id: "EXtraining-1",
          status: "notStarted",
          start: "2026-07-12T11:38:00",
          timeZone: "UTC",
        };
        return {
          data: spec.schema.parse(raw),
          host: "api.accelerate.cloudshare.com",
          integrationSurface: "cloudshare.v4.training.get",
          request: { method: spec.method, path: spec.path },
          response: { status: 200, body: raw },
        };
      },
    );
    const client = {
      requestV4Detailed,
      requestV4: vi.fn(),
      requestV3: vi.fn(),
    } as unknown as CloudShareClient;
    const labs = createCloudShareLabProvisioner(client);

    await expect(
      labs.getTrainingStartState!({ trainingId: "EXtraining-1" }),
    ).resolves.toEqual({
      trainingId: "EXtraining-1",
      status: "notStarted",
      rawStartsAt: "2026-07-12T11:38:00",
      startsAt: new Date("2026-07-12T11:38:00.000Z"),
      timeZone: "UTC",
      integrationSurface: "cloudshare.v4.training.get",
      request: { method: "GET", path: "/trainings/EXtraining-1" },
      response: {
        status: 200,
        body: {
          id: "EXtraining-1",
          status: "notStarted",
          start: "2026-07-12T11:38:00",
          timeZone: "UTC",
        },
      },
    });
    expect(requestV4Detailed).toHaveBeenCalledWith({
      method: "GET",
      path: "/trainings/EXtraining-1",
      schema: expect.anything(),
    });
  });

  it("adds missing training user-property keys through the v4 Experience user-property endpoint", async () => {
    const requestV4Detailed = vi.fn(async (spec: { method: string; path: string; body?: unknown; schema: { parse(value: unknown): unknown } }) => {
      if (spec.method === "GET") {
        const raw = [
          {
            id: "TF-certalisExamAttemptId",
            name: "certalisExamAttemptId",
            type: 0,
            isRequired: false,
            regex: "",
            defaultValue: null,
            value: null,
          },
        ];
        return {
          data: spec.schema.parse(raw),
          host: "api.accelerate.cloudshare.com",
          integrationSurface: "cloudshare.v4.training.user_properties",
          request: {
            method: spec.method,
            path: spec.path,
          },
          response: { status: 200, body: raw },
        };
      }
      const raw = [
        {
          id: "TF-certalisCandidateId",
          name: "certalisCandidateId",
          type: 0,
          isRequired: false,
          regex: "",
          defaultValue: null,
          value: null,
        },
      ];
      return {
        data: spec.schema.parse(raw),
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training.user_properties",
        request: {
          method: spec.method,
          path: spec.path,
          body: spec.body,
        },
        response: { status: 201, body: raw },
      };
    });
    const client = {
      requestV4Detailed,
      requestV4: vi.fn(),
      requestV3: vi.fn(),
    } as unknown as CloudShareClient;
    const labs = createCloudShareLabProvisioner(client);

    await expect(
      labs.ensureTrainingUserPropertyKeys!({
        trainingId: "EXtraining-1",
        requiredKeys: [
          "certalisExamAttemptId",
          "certalisCandidateId",
        ],
      }),
    ).resolves.toEqual({
      trainingId: "EXtraining-1",
      requiredKeys: [
        "certalisExamAttemptId",
        "certalisCandidateId",
      ],
      availableKeys: [
        "certalisExamAttemptId",
        "certalisCandidateId",
      ],
      definitions: [
        {
          id: "TF-certalisExamAttemptId",
          name: "certalisExamAttemptId",
          type: 0,
          isRequired: false,
          regex: "",
          defaultValue: null,
          value: null,
        },
        {
          id: "TF-certalisCandidateId",
          name: "certalisCandidateId",
          type: 0,
          isRequired: false,
          regex: "",
          defaultValue: null,
          value: null,
        },
      ],
      integrationSurface: "cloudshare.v4.training.user_properties",
      request: {
        method: "POST",
        path: "/trainings/EXtraining-1/users/properties",
        body: [{ name: "certalisCandidateId" }],
      },
      response: {
        status: 201,
        body: [
          {
            id: "TF-certalisCandidateId",
            name: "certalisCandidateId",
            type: 0,
            isRequired: false,
            regex: "",
            defaultValue: null,
            value: null,
          },
        ],
      },
      requests: [
        {
          method: "GET",
          path: "/trainings/EXtraining-1/users/properties",
        },
        {
          method: "POST",
          path: "/trainings/EXtraining-1/users/properties",
          body: [{ name: "certalisCandidateId" }],
        },
      ],
      responses: [
        {
          status: 200,
          body: [
            {
              id: "TF-certalisExamAttemptId",
              name: "certalisExamAttemptId",
              type: 0,
              isRequired: false,
              regex: "",
              defaultValue: null,
              value: null,
            },
          ],
        },
        {
          status: 201,
          body: [
            {
              id: "TF-certalisCandidateId",
              name: "certalisCandidateId",
              type: 0,
              isRequired: false,
              regex: "",
              defaultValue: null,
              value: null,
            },
          ],
        },
      ],
    });
    expect(requestV4Detailed).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "POST",
        path: "/trainings/EXtraining-1/users/properties",
        body: [{ name: "certalisCandidateId" }],
      }),
    );
  });

  it("rejects training user-property provisioning when CloudShare returns a partial create response", async () => {
    const requestV4Detailed = vi.fn(async (spec: { method: string; path: string; body?: unknown; schema: { parse(value: unknown): unknown } }) => {
      const raw = spec.method === "GET" ? [] : [{ id: "TF-certalisExamAttemptId", name: "certalisExamAttemptId" }];
      return {
        data: spec.schema.parse(raw),
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training.user_properties",
        request: {
          method: spec.method,
          path: spec.path,
          ...(spec.body ? { body: spec.body } : {}),
        },
        response: { status: spec.method === "GET" ? 200 : 201, body: raw },
      };
    });
    const client = {
      requestV4Detailed,
      requestV4: vi.fn(),
      requestV3: vi.fn(),
    } as unknown as CloudShareClient;
    const labs = createCloudShareLabProvisioner(client);

    await expect(
      labs.ensureTrainingUserPropertyKeys!({
        trainingId: "EXtraining-1",
        requiredKeys: ["certalisExamAttemptId", "certalisCandidateId"],
      }),
    ).rejects.toMatchObject({
      name: "CloudShareResponseError",
      context: {
        method: "POST",
        path: "/trainings/EXtraining-1/users/properties",
        integrationSurface: "cloudshare.v4.training.user_properties",
        status: 201,
        cause: "missing_training_user_property_keys_after_create",
        responseBody: [{ id: "TF-certalisExamAttemptId", name: "certalisExamAttemptId" }],
      },
    });
  });

  it("treats timezone-less CloudShare training start readback as UTC", async () => {
    const requestV4Detailed = vi.fn(
      async (spec: { method: string; path: string; schema: { parse(value: unknown): unknown } }) => {
        const raw = {
          id: "EXtraining-1",
          status: "notStarted",
          start: "2026-07-12T11:38:00",
        };
        return {
          data: spec.schema.parse(raw),
          host: "api.accelerate.cloudshare.com",
          integrationSurface: "cloudshare.v4.training.get",
          request: { method: spec.method, path: spec.path },
          response: { status: 200, body: raw },
        };
      },
    );
    const labs = createCloudShareLabProvisioner({
      requestV4Detailed,
      requestV4: vi.fn(),
      requestV3: vi.fn(),
    } as unknown as CloudShareClient);

    await expect(
      labs.getTrainingStartState!({ trainingId: "EXtraining-1" }),
    ).resolves.toMatchObject({
      trainingId: "EXtraining-1",
      rawStartsAt: "2026-07-12T11:38:00",
      startsAt: new Date("2026-07-12T11:38:00.000Z"),
    });
  });

  it("returns top-level response diagnostics for addParticipant", async () => {
    const requestV4Detailed = vi.fn(
      async (spec: { path: string; body?: unknown; schema: { parse(value: unknown): unknown } }) => ({
        data: spec.schema.parse([
          {
            email: "candidate@helioscx.demo",
            firstName: "Candidate",
            lastName: "Demo",
          },
        ]),
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training.participant",
        request: {
          method: "POST",
          path: spec.path,
          body: spec.body,
        },
        response: {
          status: 200,
          headers: { "content-type": "application/json" },
          body: [
            {
              email: "candidate@helioscx.demo",
              firstName: "Candidate",
              lastName: "Demo",
            },
          ],
        },
      }),
    );
    const client = {
      requestV4Detailed,
      requestV4: vi.fn(),
      requestV3: vi.fn(),
    } as unknown as CloudShareClient;
    const labs = createCloudShareLabProvisioner(client);

    const result = await labs.addParticipant!({
      trainingId: "training-1",
      email: "candidate@helioscx.demo",
      firstName: "Candidate",
      lastName: "Demo",
    });

    expect(result).toEqual({
      integrationSurface: "cloudshare.v4.training.participant",
      request: {
        method: "POST",
        path: "/trainings/training-1/students",
        body: [
          {
            email: "candidate@helioscx.demo",
            firstName: "Candidate",
            lastName: "Demo",
          },
        ],
      },
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: [
          {
            email: "candidate@helioscx.demo",
            firstName: "Candidate",
            lastName: "Demo",
          },
        ],
      },
    });
  });

  it("fails fast when the client cannot provide v4 detailed diagnostics", async () => {
    const client = {
      requestV4: vi.fn(async () => ({ id: "exp-1" })),
      requestV3: vi.fn(),
    } as unknown as CloudShareClient;

    expect(() => createCloudShareLabProvisioner(client)).toThrow(
      "CloudShare lab provisioning diagnostics require requestV4Detailed support.",
    );
  });

  it("propagates the complete sanitized v3 team exchange to its observer", async () => {
    const requestV3Detailed = vi.fn(async (spec: { schema: { parse(value: unknown): unknown } }) => {
      const body = {
        rows: [{ id: "TM-team-1", name: "Helios Team", description: "Exam delivery" }],
        total: 1,
      };
      return {
        data: spec.schema.parse(body),
        host: "use.cloudshare.com",
        integrationSurface: "cloudshare.v3.teams",
        request: {
          method: "GET",
          path: "/teams",
          query: { projectId: "project-1", getRows: "true", take: "20" },
          headers: { authorization: "[REDACTED]" },
        },
        response: {
          status: 200,
          headers: { "x-request-id": "req-team-1" },
          body,
        },
      };
    });
    const observer = { onTeamReadSuccess: vi.fn() };
    const client = {
      requestV3: vi.fn(),
      requestV3Detailed,
      requestV4Detailed: vi.fn(async (spec: { schema: { parse(value: unknown): unknown } }) => ({
        data: spec.schema.parse({ id: "exp-1" }),
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training",
        request: { method: "POST", path: "/trainings" },
        response: { status: 200, body: { id: "exp-1" } },
      })),
    } as unknown as CloudShareClient;

    await createCloudShareLabProvisioner(client, observer).createTraining!({
      title: "Exam GCP-ASSOC",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      endsAt: new Date("2026-06-15T17:30:00.000Z"),
      projectId: "project-1",
      blueprintId: "bp-1",
      policyId: "policy-1",
      regionIds: ["region-1"],
      instructorId: "instructor@example.com",
      passphrase: "certalis-attempt-1",
      timeZoneId: "UTC",
    });

    expect(requestV3Detailed).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      path: "/teams",
      query: expect.objectContaining({ projectId: "project-1" }),
    }));
    expect(observer.onTeamReadSuccess).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        query: { projectId: "project-1", getRows: "true", take: "20" },
      }),
      response: expect.objectContaining({
        headers: { "x-request-id": "req-team-1" },
        body: {
          rows: [{ id: "TM-team-1", name: "Helios Team", description: "Exam delivery" }],
          total: 1,
        },
      }),
    }));
  });

  it("accepts documented all-teams array casing while resolving a Team ID", async () => {
    const requestV3 = vi.fn(async (spec: { schema: { parse(value: unknown): unknown } }) =>
      spec.schema.parse([{ Id: "TM-team-2", Name: "Helios Team" }]),
    );
    const requestV4Detailed = vi.fn(
      async (spec: { method: string; path: string; body: { TeamId: string }; schema: { parse(value: unknown): unknown } }) => ({
        data: spec.schema.parse({ id: "exp-1" }),
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training",
        request: { method: spec.method, path: spec.path, body: spec.body },
        response: { status: 200, body: { id: "exp-1" } },
      }),
    );
    const client = { requestV4Detailed, requestV4: vi.fn(), requestV3 } as unknown as CloudShareClient;
    const labs = createCloudShareLabProvisioner(client);

    await labs.createTraining!({
      title: "Exam GCP-ASSOC",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      endsAt: new Date("2026-06-15T17:30:00.000Z"),
      projectId: "project-1",
      blueprintId: "bp-1",
      policyId: "policy-1",
      regionIds: ["region-1"],
      instructorId: "instructor@example.com",
      passphrase: "certalis-attempt-1",
      timeZoneId: "UTC",
    });

    const spec = requestV4Detailed.mock.calls[0][0] as { body: { TeamId: string } };
    expect(spec.body.TeamId).toBe("TM-team-2");
  });
});

describe("cloudShareLabProvisioner — fixture mode (live/fixture parity)", () => {
  const stubToken: V4TokenProvider = { getToken: async () => "test-bearer" };
  const fixturesDir = fileURLToPath(new URL("./fixtures", import.meta.url));

  function fixtureClient() {
    return createCloudShareClient({
      http: createFixtureHttpClient(loadFixturesFromDir(fixturesDir)),
      endpoints: {
        v4BaseUrl: "https://api.accelerate.cloudshare.com/v4",
        v3BaseUrl: "https://use.cloudshare.com/api/v3",
      },
      tokenProvider: stubToken,
      v3: { apiId: "id", apiKey: "key" },
    });
  }

  it("runs the full provision sequence against recorded fixtures (no live calls)", async () => {
    const labs = createCloudShareLabProvisioner(fixtureClient());

    const { trainingId } = await labs.createTraining!({
      title: "Exam GCP-ASSOC",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      endsAt: new Date("2026-06-15T17:30:00.000Z"),
      projectId: "project-1",
      blueprintId: "bp-1",
      policyId: "policy-1",
      regionIds: ["region-1"],
      instructorId: "instructor@example.com",
      passphrase: "certalis-attempt-1",
      timeZoneId: "UTC",
    });
    expect(trainingId).toBe("exp-demo-1");

    await expect(
      labs.addParticipant!({
        trainingId,
        email: "candidate@helioscx.demo",
        firstName: "Candidate",
        lastName: "Demo",
      }),
    ).resolves.toMatchObject({
      response: {
        status: 200,
        body: [
          {
            email: "candidate@helioscx.demo",
            firstName: "Candidate",
            lastName: "Demo",
          },
        ],
      },
    });

    const { loginUrl } = await labs.createSponsoredLink({
      trainingId,
      email: "candidate@helioscx.demo",
      firstName: "Candidate",
      lastName: "Demo",
    });
    expect(loginUrl).toContain("classic.cloudshare.com");
  });
});
