import { describe, it, expect, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { createCloudShareLabProvisioner } from "./labs";
import { createCloudShareClient } from "./client";
import { createFixtureHttpClient, loadFixturesFromDir } from "./fixtures";
import type { CloudShareClient } from "./client";
import type { V4TokenProvider } from "./v4-auth";

describe("cloudShareLabProvisioner — request shape", () => {
  it("creates a training with instructorLed timing and exam provisioning tuple", async () => {
    const requestV4 = vi.fn(async (_spec: unknown) => ({ id: "exp-1" }));
    const client = { requestV4, requestV3: vi.fn() } as unknown as CloudShareClient;
    const labs = createCloudShareLabProvisioner(client);

    const result = await labs.createTraining!({
      title: "Exam GCP-ASSOC",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      projectId: "project-1",
      blueprintId: "bp-1",
      policyId: "policy-1",
      regionIds: ["region-1", "region-2"],
      instructorId: "instructor@example.com",
      passphrase: "certalis-attempt-1",
      timeZoneId: "UTC",
    });

    expect(result).toEqual({ trainingId: "exp-1" });
    const spec = requestV4.mock.calls[0][0] as unknown as {
      method: string;
      path: string;
      body: Record<string, unknown>;
    };
    expect(spec.method).toBe("POST");
    expect(spec.path).toBe("/trainings");
    expect(spec.body).toEqual({
      Name: "Exam GCP-ASSOC",
      Start: "2026-06-15T16:00:00.000Z",
      Type: "instructorLed",
      ProjectId: "project-1",
      TeamId: "project-1",
      BlueprintIds: ["bp-1"],
      PolicyId: "policy-1",
      CloudshareRegionIds: ["region-1", "region-2"],
      MainInstructor: { Email: "instructor@example.com" },
      TimeZone: "UTC",
      Passphrase: "certalis-attempt-1",
      UsersEarlyAccess: { GrantEarlyAccess: 2 },
    });
  });

  it("targets the training-scoped participant and sponsored-link paths", async () => {
    const requestV4 = vi.fn(async (spec: { path: string; body?: unknown }) =>
      spec.path.endsWith("/sponsored-link")
        ? { loginUrl: "https://classic.cloudshare.com/login?t=x" }
        : {},
    );
    const client = { requestV4, requestV3: vi.fn() } as unknown as CloudShareClient;
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

    expect(requestV4.mock.calls[0][0].path).toBe("/trainings/training-1/students");
    expect(requestV4.mock.calls[0][0].body).toEqual({
      email: "candidate@helioscx.demo",
      firstName: "Candidate",
      lastName: "Demo",
    });
    expect(requestV4.mock.calls[1][0].path).toBe("/trainings/training-1/sponsored-link");
    expect(requestV4.mock.calls[1][0].body).toEqual({
      email: "candidate@helioscx.demo",
      firstName: "Candidate",
      lastName: "Demo",
    });
    expect(link.loginUrl).toContain("classic.cloudshare.com");
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
    ).resolves.toBeUndefined();

    const { loginUrl } = await labs.createSponsoredLink({
      trainingId,
      email: "candidate@helioscx.demo",
      firstName: "Candidate",
      lastName: "Demo",
    });
    expect(loginUrl).toContain("classic.cloudshare.com");
  });
});
