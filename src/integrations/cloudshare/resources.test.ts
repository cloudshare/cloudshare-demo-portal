import { describe, it, expect, vi } from "vitest";
import { createCloudShareResourceLister } from "./resources";
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
    "v3:/projects/p-1/blueprints": [{ id: "bp-1", name: "Cloud Blueprint" }],
    "v3:/policies": [{ id: "pol-1", name: "Exam Policy" }],
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

  it("lists blueprints per project via v3", async () => {
    const lister = createCloudShareResourceLister(mockClient);
    const result = await lister.listBlueprints();
    expect(result).toEqual([{ id: "bp-1", name: "Cloud Blueprint" }]);
  });

  it("flattens blueprints from multiple projects", async () => {
    const multiProjectClient = makeClient({
      "v3:/projects": [
        { id: "p-1", name: "Helios CX" },
        { id: "p-2", name: "Northwind" },
      ],
      "v3:/projects/p-1/blueprints": [{ id: "bp-1", name: "Blueprint One" }],
      "v3:/projects/p-2/blueprints": [{ id: "bp-2", name: "Blueprint Two" }],
    });

    const lister = createCloudShareResourceLister(multiProjectClient);
    const result = await lister.listBlueprints();

    expect(result).toEqual([
      { id: "bp-1", name: "Blueprint One" },
      { id: "bp-2", name: "Blueprint Two" },
    ]);
  });

  it("lists policies via v3", async () => {
    const lister = createCloudShareResourceLister(mockClient);
    const result = await lister.listPolicies();
    expect(result).toEqual([{ id: "pol-1", name: "Exam Policy" }]);
  });
});
