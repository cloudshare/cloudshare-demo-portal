import { describe, it, expect, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { createCloudShareLabProvisioner } from "./labs";
import { createCloudShareClient } from "./client";
import { createFixtureHttpClient, loadFixturesFromDir } from "./fixtures";
import type { CloudShareClient } from "./client";
import type { V4TokenProvider } from "./v4-auth";

describe("cloudShareLabProvisioner — request shape", () => {
  it("creates the experience as Registered Students Only and passes the externalId", async () => {
    const requestV4 = vi.fn(async (_spec: unknown) => ({ id: "exp-1" }));
    const client = { requestV4, requestV3: vi.fn() } as unknown as CloudShareClient;
    const labs = createCloudShareLabProvisioner(client);

    const result = await labs.createExperience({
      title: "Exam GCP-ASSOC",
      environmentExternalId: "env-ext-1",
      registeredStudentsOnly: true,
    });

    expect(result).toEqual({ experienceId: "exp-1" });
    const spec = requestV4.mock.calls[0][0] as unknown as {
      method: string;
      path: string;
      body: Record<string, unknown>;
    };
    expect(spec.method).toBe("POST");
    expect(spec.path).toBe("/experiences");
    expect(spec.body).toMatchObject({
      visibility: "RegisteredStudentsOnly",
      externalId: "env-ext-1",
    });
  });

  it("targets the experience-scoped paths for add-student and sponsored-link", async () => {
    const requestV4 = vi.fn(async (spec: { path: string }) =>
      spec.path.endsWith("/sponsoredLinks")
        ? { loginUrl: "https://classic.cloudshare.com/login?t=x" }
        : {},
    );
    const client = { requestV4, requestV3: vi.fn() } as unknown as CloudShareClient;
    const labs = createCloudShareLabProvisioner(client);

    await labs.addStudent({ experienceId: "exp-1", candidateId: "c-1" });
    const link = await labs.createSponsoredLink({ experienceId: "exp-1" });

    expect(requestV4.mock.calls[0][0].path).toBe("/experiences/exp-1/students");
    expect(requestV4.mock.calls[1][0].path).toBe("/experiences/exp-1/sponsoredLinks");
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

    const { experienceId } = await labs.createExperience({
      title: "Exam GCP-ASSOC",
      environmentExternalId: "env-ext-1",
      registeredStudentsOnly: true,
    });
    expect(experienceId).toBe("exp-demo-1");

    await expect(
      labs.addStudent({ experienceId, candidateId: "cand-001" }),
    ).resolves.toBeUndefined();

    const { loginUrl } = await labs.createSponsoredLink({ experienceId });
    expect(loginUrl).toContain("classic.cloudshare.com");
  });
});
