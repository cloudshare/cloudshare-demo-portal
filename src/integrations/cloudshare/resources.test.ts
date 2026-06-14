import { describe, it, expect, vi } from "vitest";
import {
  createCloudShareExamAuthoringSource,
  createCloudShareResourceLister,
} from "./resources";
import type { CloudShareClient } from "./client";

function makeClient(responses: Record<string, unknown>): CloudShareClient {
  return {
    requestV4: vi.fn().mockImplementation(({ path }: { path: string }) => {
      const key = `v4:${path}`;
      if (key in responses) return Promise.resolve(responses[key]);
      return Promise.reject(new Error(`No mock for v4 ${path}`));
    }),
    requestV3: vi.fn().mockImplementation(({ path }: { path: string }) => {
      const key = `v3:${path}`;
      if (key in responses) return Promise.resolve(responses[key]);
      return Promise.reject(new Error(`No mock for v3 ${path}`));
    }),
  } as unknown as CloudShareClient;
}

describe("createCloudShareResourceLister", () => {
  const mockClient = makeClient({
    "v3:/projects": [{ id: "p-1", name: "Helios CX" }],
    "v3:/regions": [{ id: "r-1", name: "EU West" }],
  });

  it("lists projects via v3", async () => {
    const lister = createCloudShareResourceLister(mockClient);
    const result = await lister.listProjects();
    expect(result).toEqual([{ id: "p-1", name: "Helios CX" }]);
  });

  it("lists regions via v3", async () => {
    const lister = createCloudShareResourceLister(mockClient);
    const result = await lister.listRegions();
    expect(result).toEqual([{ id: "r-1", name: "EU West" }]);
  });

  it("does not pretend blueprints are globally listable", async () => {
    const lister = createCloudShareResourceLister(mockClient);
    const result = await lister.listBlueprints();
    expect(result).toEqual([]);
  });

  it("does not pretend policies are globally listable", async () => {
    const lister = createCloudShareResourceLister(mockClient);
    const result = await lister.listPolicies();
    expect(result).toEqual([]);
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
      { id: "bp-1", name: "Exam Blueprint" },
    ]);
  });

  it("lists project-scoped policies for a selected project", async () => {
    const source = createCloudShareExamAuthoringSource(
      makeClient({
        "v3:/projects/p-1/policies": [{ id: "pol-1", name: "Timed Policy" }],
      }),
    );

    await expect(source.listProjectPolicies("p-1")).resolves.toEqual([
      { id: "pol-1", name: "Timed Policy" },
    ]);
  });

  it("maps blueprint detail snapshots with the default snapshot signal", async () => {
    const source = createCloudShareExamAuthoringSource(
      makeClient({
        "v3:/projects/p-1/blueprints/bp-1": {
          id: "bp-1",
          name: "Exam Blueprint",
          createFromVersions: [
            { id: "snap-1", name: "Snapshot 1", isDefault: true },
            { id: "snap-2", name: "Snapshot 2", isDefault: false },
          ],
        },
      }),
    );

    await expect(source.getBlueprintDetail("p-1", "bp-1")).resolves.toEqual({
      id: "bp-1",
      name: "Exam Blueprint",
      defaultSnapshotId: "snap-1",
      snapshots: [
        { id: "snap-1", name: "Snapshot 1", isDefault: true },
        { id: "snap-2", name: "Snapshot 2", isDefault: false },
      ],
    });
  });
});
