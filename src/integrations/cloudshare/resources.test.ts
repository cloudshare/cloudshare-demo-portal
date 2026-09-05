import { describe, it, expect, vi } from "vitest";
import { createCloudShareClient, createCloudShareNoopRequestObserver } from "./client";
import { CloudShareResponseError } from "./errors";
import type { HttpClient } from "./http";
import {
  createCloudShareExamAuthoringSource,
  createCloudShareResourceLister,
  createCloudShareSalesItemResourceSource,
  CloudShareSalesResourceReadError,
} from "./resources";
import type { CloudShareClient } from "./client";

function makeClient(responses: Record<string, unknown>): CloudShareClient {
  const requestV4Impl = ({ path, schema }: { path: string; schema?: { parse(value: unknown): unknown } }) => {
    const key = `v4:${path}`;
    if (key in responses) {
      const value = responses[key];
      return Promise.resolve(schema ? schema.parse(value) : value);
    }
    return Promise.reject(new Error(`No mock for v4 ${path}`));
  };
  const requestV3Impl = ({ path, schema }: { path: string; schema?: { parse(value: unknown): unknown } }) => {
    const key = `v3:${path}`;
    if (key in responses) {
      const value = responses[key];
      return Promise.resolve(schema ? schema.parse(value) : value);
    }
    return Promise.reject(new Error(`No mock for v3 ${path}`));
  };

  return {
    requestV4: vi.fn().mockImplementation(requestV4Impl),
    requestV4Detailed: vi.fn().mockImplementation(async (spec: { path: string; method: string; schema?: { parse(value: unknown): unknown } }) => ({
      data: await requestV4Impl(spec),
      host: "api.accelerate.cloudshare.com",
      integrationSurface: "cloudshare.v4",
      request: { method: spec.method, path: spec.path },
      response: { status: 200, body: responses[`v4:${spec.path}`] },
    })),
    requestV3: vi.fn().mockImplementation(requestV3Impl),
    requestV3Detailed: vi.fn().mockImplementation(async (spec: { path: string; method: string; schema?: { parse(value: unknown): unknown } }) => ({
      data: await requestV3Impl(spec),
      host: "use.cloudshare.com",
      integrationSurface: "cloudshare.v3",
      request: { method: spec.method, path: spec.path },
      response: { status: 200, body: responses[`v3:${spec.path}`] },
    })),
    requestV3Text: vi.fn(),
    requestV3TextDetailed: vi.fn(),
  } as unknown as CloudShareClient;
}

function makeAuthoringSourceWithRealClient(
  responseBody: unknown,
): ReturnType<typeof createCloudShareExamAuthoringSource> {
  const http: HttpClient = {
    async send() {
      return { status: 200, body: JSON.stringify(responseBody) };
    },
  };

  const client = createCloudShareClient({
    http,
    endpoints: {
      v4BaseUrl: "https://api.accelerate.cloudshare.com/v4",
      v3BaseUrl: "https://use.cloudshare.com/api/v3",
    },
    tokenProvider: { getToken: async () => "test-bearer" },
    v3: { apiId: "api-id", apiKey: "api-key" },
    observer: createCloudShareNoopRequestObserver(),
    newToken: () => "tokfixed01",
    now: () => 1_700_000_000_000,
  });

  return createCloudShareExamAuthoringSource(client);
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

  it("forwards the complete detailed exchange to an authoring read observer", async () => {
    const onReadSuccess = vi.fn();
    const client = makeClient({ "v3:/projects": [{ id: "p-1", name: "Helios CX" }] });
    (client.requestV3Detailed as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: [{ id: "p-1", name: "Helios CX" }],
      request: { method: "GET", path: "/projects", query: { include: "all" } },
      response: {
        status: 200,
        headers: { "x-cloudshare-request": "provider-request-1" },
        body: [{ id: "p-1", name: "Helios CX", providerField: "retained" }],
      },
    });

    const source = createCloudShareExamAuthoringSource(client, { onReadSuccess });
    await source.listProjects();

    expect(onReadSuccess).toHaveBeenCalledWith(expect.objectContaining({
      request: { method: "GET", path: "/projects", query: { include: "all" } },
      response: {
        status: 200,
        headers: { "x-cloudshare-request": "provider-request-1" },
        body: [{ id: "p-1", name: "Helios CX", providerField: "retained" }],
      },
    }));
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
          storageLeaseMinutes: 2880,
        },
      }),
    );

    await expect(source.listProjectPolicies("p-1")).resolves.toMatchObject([
      {
        id: "pol-1",
        name: "Timed Policy",
        runtimeLeaseMinutes: 240,
        storageLeaseMinutes: 2880,
        diagnosticRequest: {
          method: "GET",
          path: "/projects/p-1/policies/pol-1",
        },
        diagnosticResponse: {
          status: 200,
          body: {
            id: "pol-1",
            name: "Timed Policy",
            runtimeLeaseMinutes: 240,
            storageLeaseMinutes: 2880,
          },
        },
      },
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

  it("rejects unrelated blueprint detail payloads at the CloudShare adapter seam", async () => {
    const source = makeAuthoringSourceWithRealClient({});

    await expect(source.getBlueprintDetail("p-1", "bp-1")).rejects.toBeInstanceOf(
      CloudShareResponseError,
    );
  });

  it("rejects generic blueprint fragments with only resources at the adapter seam", async () => {
    const source = makeAuthoringSourceWithRealClient({ resources: {} });

    await expect(source.getBlueprintDetail("p-1", "bp-1")).rejects.toBeInstanceOf(
      CloudShareResponseError,
    );
  });

  it("rejects generic blueprint fragments with only imageUrl at the adapter seam", async () => {
    const source = makeAuthoringSourceWithRealClient({ imageUrl: null });

    await expect(source.getBlueprintDetail("p-1", "bp-1")).rejects.toBeInstanceOf(
      CloudShareResponseError,
    );
  });

  it("accepts documented blueprint detail responses with PascalCase CreateFromVersions", async () => {
    const source = createCloudShareExamAuthoringSource(
      makeClient({
        "v3:/projects/p-1/blueprints/bp-1": {
          Type: 0,
          CreateFromVersions: [
            {
              id: "snap-1",
              name: "Default Snapshot",
              isDefault: true,
              Regions: ["r-1"],
            },
          ],
        },
      }),
    );

    await expect(source.getBlueprintDetail("p-1", "bp-1")).resolves.toMatchObject({
      id: "bp-1",
      name: "bp-1",
      defaultSnapshotId: "snap-1",
      snapshots: [{ id: "snap-1", name: "Default Snapshot", isDefault: true, regionIds: ["r-1"] }],
    });
  });

  it("accepts CloudShare blueprint detail variants from the documented v3 response shape", async () => {
    const source = createCloudShareExamAuthoringSource(
      makeClient({
        "v3:/projects/p-1/blueprints/bp-1": {
          createFromVersions: [
            {
              id: "snap-1",
              name: "Default Snapshot",
              description: null,
              comment: null,
              type: 0,
              isDefault: true,
              isLatest: true,
              number: 3,
              createTime: "Wed, 24 Oct 2012 14:45:25 GMT",
              Regions: ["r-1", "r-2"],
              Machines: [
                {
                  Id: "machine-1",
                  Name: "Gateway",
                  OsTypeName: "Windows",
                  Resources: { cpuCount: 2, memorySizeMB: 2048 },
                  HttpAccessEnabled: false,
                  CanAddMultipleInstances: true,
                },
              ],
            },
          ],
          type: 0,
          imageUrl: null,
          resources: {
            cpuCount: 2,
            diskSizeMB: 32768,
            memorySizeMB: 2048,
          },
          numberOfMachines: 1,
          creationDate: "Mon, 30 Mar 2014 03:26:40 GMT",
        },
      }),
    );

    await expect(source.getBlueprintDetail("p-1", "bp-1")).resolves.toMatchObject({
      id: "bp-1",
      name: "bp-1",
      description: "",
      defaultSnapshotId: "snap-1",
      snapshots: [{ id: "snap-1", name: "Default Snapshot", isDefault: true, regionIds: ["r-1", "r-2"] }],
      diagnosticSummary: {
        blueprintId: "bp-1",
        name: "bp-1",
        description: "",
        type: 0,
        creationDate: "Mon, 30 Mar 2014 03:26:40 GMT",
        resources: {
          cpuCount: 2,
          diskSizeMB: 32768,
          memorySizeMB: 2048,
        },
        numberOfMachines: 1,
        imageUrl: { present: false },
        defaultSnapshotId: "snap-1",
        snapshotCount: 1,
        snapshots: [
          {
            id: "snap-1",
            name: "Default Snapshot",
            isDefault: true,
            isLatest: true,
            type: 0,
            number: 3,
            createTime: "Wed, 24 Oct 2012 14:45:25 GMT",
            regions: [{ id: "r-1" }, { id: "r-2" }],
            machineCount: 1,
            machines: [
              {
                id: "machine-1",
                name: "Gateway",
                osTypeName: "Windows",
                resources: { cpuCount: 2, memorySizeMB: 2048 },
                httpAccessEnabled: false,
                canAddMultipleInstances: true,
              },
            ],
          },
        ],
      },
    });
  });

  it("accepts snapshot versions whose descriptions are present but blank", async () => {
    const source = createCloudShareExamAuthoringSource(
      makeClient({
        "v3:/projects/p-1/blueprints/bp-1": {
          id: "bp-1",
          name: "Windows Boxes",
          description: "Live tenant blueprint variant",
          createFromVersions: [
            {
              id: "snap-1",
              name: "Default Snapshot",
              description: "",
              isDefault: true,
              regions: ["r-1"],
            },
            {
              id: "snap-2",
              name: "Previous Snapshot",
              description: "",
              isDefault: false,
              regions: ["r-1"],
            },
          ],
        },
      }),
    );

    await expect(source.getBlueprintDetail("p-1", "bp-1")).resolves.toMatchObject({
      id: "bp-1",
      name: "Windows Boxes",
      description: "Live tenant blueprint variant",
      defaultSnapshotId: "snap-1",
      snapshots: [
        { id: "snap-1", name: "Default Snapshot", isDefault: true, regionIds: ["r-1"] },
        { id: "snap-2", name: "Previous Snapshot", isDefault: false, regionIds: ["r-1"] },
      ],
      diagnosticSummary: {
        blueprintId: "bp-1",
        snapshots: [
          {
            id: "snap-1",
            name: "Default Snapshot",
            isDefault: true,
            regions: [{ id: "r-1" }],
          },
          {
            id: "snap-2",
            name: "Previous Snapshot",
            isDefault: false,
            regions: [{ id: "r-1" }],
          },
        ],
      },
    });
  });
});

describe("createCloudShareSalesItemResourceSource", () => {
  it("preserves completed policy exchanges when a sibling policy detail fails", async () => {
    const source = createCloudShareSalesItemResourceSource(makeClient({
      "v3:/projects/p-1/policies": [{ id: "pol-1", name: "One" }, { id: "pol-2", name: "Two" }],
      "v3:/projects/p-1/policies/pol-1": { id: "pol-1", name: "One", storageLeaseMinutes: 60 },
    }));
    await expect(source.readProjectPolicies("p-1")).rejects.toMatchObject({
      name: "CloudShareSalesResourceReadError",
      completedReads: [
        { request: { path: "/projects/p-1/policies" } },
        { request: { path: "/projects/p-1/policies/pol-1" } },
      ],
    });
  });
});
