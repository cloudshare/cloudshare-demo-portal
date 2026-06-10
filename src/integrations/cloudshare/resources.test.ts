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
    "v4:/projects": [{ id: "p-1", name: "Genesys Cert" }],
    "v3:/regions": [{ id: "r-1", name: "EU West" }],
    "v3:/blueprints": [{ id: "bp-1", name: "Cloud Blueprint" }],
    "v3:/policies": [{ id: "pol-1", name: "Exam Policy" }],
  });

  it("lists projects via v4", async () => {
    const lister = createCloudShareResourceLister(mockClient);
    const result = await lister.listProjects();
    expect(result).toEqual([{ id: "p-1", name: "Genesys Cert" }]);
  });

  it("lists regions via v3", async () => {
    const lister = createCloudShareResourceLister(mockClient);
    const result = await lister.listRegions();
    expect(result).toEqual([{ id: "r-1", name: "EU West" }]);
  });

  it("lists blueprints via v3", async () => {
    const lister = createCloudShareResourceLister(mockClient);
    const result = await lister.listBlueprints();
    expect(result).toEqual([{ id: "bp-1", name: "Cloud Blueprint" }]);
  });

  it("lists policies via v3", async () => {
    const lister = createCloudShareResourceLister(mockClient);
    const result = await lister.listPolicies();
    expect(result).toEqual([{ id: "pol-1", name: "Exam Policy" }]);
  });
});
