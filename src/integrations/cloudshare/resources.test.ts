import { describe, it, expect, vi } from "vitest";
import {
  createCloudShareExamAuthoringSource,
  createCloudShareResourceLister,
} from "./resources";
import type { CloudShareClient } from "./client";

function makeClient(responses: Record<string, unknown>): CloudShareClient {
  return {
    requestV4: vi.fn().mockImplementation(({ path, schema }: { path: string; schema?: { parse(value: unknown): unknown } }) => {
      const key = `v4:${path}`;
      if (key in responses) {
        const value = responses[key];
        return Promise.resolve(schema ? schema.parse(value) : value);
      }
      return Promise.reject(new Error(`No mock for v4 ${path}`));
    }),
    requestV3: vi.fn().mockImplementation(({ path, schema }: { path: string; schema?: { parse(value: unknown): unknown } }) => {
      const key = `v3:${path}`;
      if (key in responses) {
        const value = responses[key];
        return Promise.resolve(schema ? schema.parse(value) : value);
      }
      return Promise.reject(new Error(`No mock for v3 ${path}`));
    }),
  } as unknown as CloudShareClient;
}

describe("createCloudShareResourceLister", () => {
  const mockClient = makeClient({
    "v3:/projects": [{ id: "p-1", name: "Helios CX" }],
    "v3:/regions": [
      { id: "r-1", name: "Miami", friendlyName: "US East (Miami)", cloudName: "AWS" },
    ],
    "v3:/projects/p-1/blueprints": [{ id: "bp-1", name: "Blueprint 1" }],
    "v3:/projects/p-1/policies": [{ id: "pol-1", name: "Policy 1" }],
  });

  it("lists projects via v3", async () => {
    const lister = createCloudShareResourceLister(mockClient);
    const result = await lister.listProjects();
    expect(result).toEqual([{ id: "p-1", name: "Helios CX" }]);
  });

  it("lists regions via v3", async () => {
    const lister = createCloudShareResourceLister(mockClient);
    const result = await lister.listRegions();
    expect(result).toEqual([
      {
        id: "r-1",
        name: "Miami",
        friendlyName: "US East (Miami)",
      },
    ]);
  });

  it("lists project-scoped blueprints during legacy resource sync", async () => {
    const lister = createCloudShareResourceLister(mockClient);
    const result = await lister.listBlueprints();
    expect(result).toEqual([{ id: "bp-1", name: "Blueprint 1" }]);
  });

  it("lists project-scoped policies during legacy resource sync", async () => {
    const lister = createCloudShareResourceLister(mockClient);
    const result = await lister.listPolicies();
    expect(result).toEqual([{ id: "pol-1", name: "Policy 1" }]);
  });
});

describe("createCloudShareExamAuthoringSource", () => {
  it("lists project-scoped blueprints for a selected project", async () => {
    const source = createCloudShareExamAuthoringSource(
      makeClient({
        "v3:/projects/p-1/blueprints": [{ id: "bp-1", name: "Exam Blueprint" }],
      }),
    );

    await expect(source.listProjectBlueprints("p-1")).resolves.toEqual([
      { id: "bp-1", name: "Exam Blueprint", description: "" },
    ]);
  });

  it("lists project-scoped policies for a selected project", async () => {
    const source = createCloudShareExamAuthoringSource(
      makeClient({
        "v3:/projects/p-1/policies": [{ id: "pol-1", name: "Timed Policy" }],
        "v3:/projects/p-1/policies/pol-1": {
          id: "pol-1",
          name: "Timed Policy",
          projectId: "p-1",
          allowEnvironmentCreation: true,
          runtimeLeaseMinutes: 240,
        },
      }),
    );

    await expect(source.listProjectPolicies("p-1")).resolves.toEqual([
      { id: "pol-1", name: "Timed Policy", runtimeLeaseMinutes: 240 },
    ]);
  });

  it("maps blueprint detail snapshots with the default snapshot signal", async () => {
    const source = createCloudShareExamAuthoringSource(
      makeClient({
        "v3:/projects/p-1/blueprints/bp-1": {
          id: "bp-1",
          name: "Exam Blueprint",
          description: "Default tenant-ready environment.",
          createFromVersions: [
            {
              id: "snap-1",
              name: "Snapshot 1",
              isDefault: true,
              regions: [{ id: "r-1", name: "EU West" }],
            },
            {
              id: "snap-2",
              name: "Snapshot 2",
              isDefault: false,
              regions: [{ id: "r-2", name: "US East" }],
            },
          ],
        },
      }),
    );

    await expect(source.getBlueprintDetail("p-1", "bp-1")).resolves.toMatchObject({
      id: "bp-1",
      name: "Exam Blueprint",
      description: "Default tenant-ready environment.",
      defaultSnapshotId: "snap-1",
      snapshots: [
        { id: "snap-1", name: "Snapshot 1", isDefault: true, regionIds: ["r-1"] },
        { id: "snap-2", name: "Snapshot 2", isDefault: false, regionIds: ["r-2"] },
      ],
    });
  });

  it("accepts blueprint detail regions returned as raw region ids", async () => {
    const source = createCloudShareExamAuthoringSource(
      makeClient({
        "v3:/projects/p-1/blueprints/bp-1": {
          id: "bp-1",
          name: "Exam Blueprint",
          description: "",
          createFromVersions: [
            {
              id: "snap-1",
              name: "Snapshot 1",
              isDefault: true,
              regions: ["r-1", "r-2"],
            },
          ],
        },
      }),
    );

    await expect(source.getBlueprintDetail("p-1", "bp-1")).resolves.toMatchObject({
      id: "bp-1",
      name: "Exam Blueprint",
      description: "",
      defaultSnapshotId: "snap-1",
      snapshots: [{ id: "snap-1", name: "Snapshot 1", isDefault: true, regionIds: ["r-1", "r-2"] }],
    });
  });

  it("builds a rich redacted diagnostic summary from blueprint detail responses", async () => {
    const source = createCloudShareExamAuthoringSource(
      makeClient({
        "v3:/projects/p-1/blueprints/bp-1": {
          id: "bp-1",
          name: "Exam Blueprint",
          description: "Default tenant-ready environment.",
          type: "VmBlueprint",
          creationDate: "2026-06-20T10:00:00Z",
          resources: { ram: 16, cpu: 8 },
          numberOfMachines: 2,
          imageUrl:
            "https://use.cloudshare.com/image-library/blueprints/bp-1.png?imageToken=secret-token&size=large",
          createFromVersions: [
            {
              id: "snap-1",
              name: "Snapshot 1",
              number: 3,
              isDefault: true,
              isLatest: true,
              type: "snapshot",
              createTime: "2026-06-19T09:30:00Z",
              description: "Primary lab image",
              comment: "Approved for candidates",
              regions: [
                { id: "r-1", name: "EU West" },
                { id: "r-2", name: "US East" },
              ],
              resources: { ram: 8, cpu: 4 },
              machines: [
                {
                  id: "machine-1",
                  name: "Gateway",
                  osTypeName: "Windows Server 2022",
                  resources: { ram: 4, cpu: 2 },
                  isSaaS: false,
                  httpAccessEnabled: true,
                  resumeType: "resume",
                  bootOrder: 1,
                  canAddMultipleInstances: false,
                  internalIPs: ["10.0.0.10"],
                  macAddresses: ["00:11:22:33:44:55"],
                  user: "Administrator",
                  password: "super-secret",
                },
              ],
            },
          ],
        },
      }),
    );

    await expect(source.getBlueprintDetail("p-1", "bp-1")).resolves.toMatchObject({
      id: "bp-1",
      defaultSnapshotId: "snap-1",
      snapshots: [{ id: "snap-1", regionIds: ["r-1", "r-2"] }],
      diagnosticSummary: {
        blueprintId: "bp-1",
        name: "Exam Blueprint",
        description: "Default tenant-ready environment.",
        type: "VmBlueprint",
        creationDate: "2026-06-20T10:00:00Z",
        resources: { ram: 16, cpu: 8 },
        numberOfMachines: 2,
        imageUrl: {
          present: true,
          path: "/image-library/blueprints/bp-1.png",
          query: {
            imageToken: "[REDACTED]",
            size: "large",
          },
        },
        defaultSnapshotId: "snap-1",
        snapshotCount: 1,
        snapshots: [
          {
            id: "snap-1",
            name: "Snapshot 1",
            number: 3,
            isDefault: true,
            isLatest: true,
            type: "snapshot",
            createTime: "2026-06-19T09:30:00Z",
            description: "Primary lab image",
            comment: "Approved for candidates",
            regions: [
              { id: "r-1", name: "EU West" },
              { id: "r-2", name: "US East" },
            ],
            resources: { ram: 8, cpu: 4 },
            machineCount: 1,
            machines: [
              {
                id: "machine-1",
                name: "Gateway",
                osTypeName: "Windows Server 2022",
                resources: { ram: 4, cpu: 2 },
                isSaaS: false,
                httpAccessEnabled: true,
                resumeType: "resume",
                bootOrder: 1,
                canAddMultipleInstances: false,
              },
            ],
          },
        ],
      },
    });
  });

  it("redacts token-bearing query params for relative blueprint image urls", async () => {
    const source = createCloudShareExamAuthoringSource(
      makeClient({
        "v3:/projects/p-1/blueprints/bp-1": {
          id: "bp-1",
          name: "Exam Blueprint",
          description: "",
          imageUrl: "/image-library/blueprints/bp-1.png?imageToken=secret-token&size=large",
          createFromVersions: [
            {
              id: "snap-1",
              name: "Snapshot 1",
              isDefault: true,
              regions: ["r-1"],
            },
          ],
        },
      }),
    );

    await expect(source.getBlueprintDetail("p-1", "bp-1")).resolves.toMatchObject({
      diagnosticSummary: {
        imageUrl: {
          present: true,
          path: "/image-library/blueprints/bp-1.png",
          query: {
            imageToken: "[REDACTED]",
            size: "large",
          },
        },
      },
    });
  });

  it("accepts blueprint detail responses when createFromVersions is omitted", async () => {
    const source = createCloudShareExamAuthoringSource(
      makeClient({
        "v3:/projects/p-1/blueprints/bp-1": {
          id: "bp-1",
          name: "Exam Blueprint",
          description: "No versions returned yet",
        },
      }),
    );

    await expect(source.getBlueprintDetail("p-1", "bp-1")).resolves.toMatchObject({
      id: "bp-1",
      name: "Exam Blueprint",
      description: "No versions returned yet",
      defaultSnapshotId: null,
      snapshots: [],
      diagnosticSummary: {
        blueprintId: "bp-1",
        defaultSnapshotId: null,
        snapshotCount: 0,
        snapshots: [],
      },
    });
  });
});
