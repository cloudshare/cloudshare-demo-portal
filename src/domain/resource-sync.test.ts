import { describe, it, expect, vi } from "vitest";
import { syncResources } from "./resource-sync";
import type { CloudShareResourceLister } from "./resource-sync";
import { createInMemoryResourceRepository } from "@/persistence/resource-repository";

function makeLister(overrides: Partial<CloudShareResourceLister> = {}): CloudShareResourceLister {
  return {
    listProjects: vi.fn().mockResolvedValue([
      { id: "p-1", name: "Helios Certification Labs" },
    ]),
    listRegions: vi.fn().mockResolvedValue([
      { id: "r-1", name: "EU West" },
    ]),
    listBlueprints: vi.fn().mockResolvedValue([
      { id: "bp-1", name: "Certalis Exam Blueprint" },
    ]),
    listPolicies: vi.fn().mockResolvedValue([
      { id: "pol-1", name: "Standard Exam Policy" },
    ]),
    ...overrides,
  };
}

describe("syncResources", () => {
  it("fetches all resource types and persists mappings", async () => {
    const lister = makeLister();
    const repo = createInMemoryResourceRepository();
    const now = new Date("2026-01-01T00:00:00Z");

    const result = await syncResources({ lister, repository: repo, now: () => now });

    expect(result.synced).toBe(4); // 1+1+1+1
    expect(result.byType.project).toHaveLength(1);
    expect(result.byType.region).toHaveLength(1);
    expect(result.byType.blueprint).toHaveLength(1);
    expect(result.byType.policy).toHaveLength(1);
    expect(result.byType.project[0]).toMatchObject({
      type: "project",
      name: "Helios Certification Labs",
      cloudshareId: "p-1",
      syncedAt: now,
    });
  });

  it("persists mappings to the repository", async () => {
    const lister = makeLister();
    const repo = createInMemoryResourceRepository();

    await syncResources({ lister, repository: repo });

    const project = await repo.findByTypeAndName("project", "Helios Certification Labs");
    expect(project).not.toBeNull();
    expect(project!.cloudshareId).toBe("p-1");
  });

  it("overwrites existing mappings on re-sync", async () => {
    const repo = createInMemoryResourceRepository();
    const lister1 = makeLister({
      listProjects: vi.fn().mockResolvedValue([{ id: "p-old", name: "Helios Certification Labs" }]),
    });
    await syncResources({ lister: lister1, repository: repo });

    const lister2 = makeLister({
      listProjects: vi.fn().mockResolvedValue([{ id: "p-new", name: "Helios Certification Labs" }]),
    });
    await syncResources({ lister: lister2, repository: repo });

    const project = await repo.findByTypeAndName("project", "Helios Certification Labs");
    expect(project!.cloudshareId).toBe("p-new");
  });

  it("throws when a list call fails", async () => {
    const lister = makeLister({
      listProjects: vi.fn().mockRejectedValue(new Error("CloudShare unavailable")),
    });
    const repo = createInMemoryResourceRepository();

    await expect(syncResources({ lister, repository: repo })).rejects.toThrow(
      "CloudShare unavailable",
    );
  });

  it("allows the legacy sync path to persist only global resources", async () => {
    const lister = makeLister({
      listBlueprints: vi.fn().mockResolvedValue([]),
      listPolicies: vi.fn().mockResolvedValue([]),
    });
    const repo = createInMemoryResourceRepository();

    const result = await syncResources({ lister, repository: repo });

    expect(result.synced).toBe(2);
    expect(result.byType.project).toHaveLength(1);
    expect(result.byType.region).toHaveLength(1);
    expect(result.byType.blueprint).toEqual([]);
    expect(result.byType.policy).toEqual([]);
  });
});
