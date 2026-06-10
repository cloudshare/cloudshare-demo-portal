/**
 * Resource sync domain types and use case.
 *
 * Blueprint, policy, project, and region IDs are dynamic CloudShare identifiers
 * and must never be hard-coded. This module defines the reference table that maps
 * the portal's configured friendly names to live CloudShare IDs, and the
 * syncResources use case that refreshes it on demand from CloudShare list endpoints.
 */

export type ResourceType = "blueprint" | "policy" | "project" | "region";

export interface ResourceMapping {
  readonly type: ResourceType;
  readonly name: string;
  readonly cloudshareId: string;
  readonly syncedAt: Date;
}

export interface ResourceRepository {
  save(mapping: ResourceMapping): Promise<void>;
  findByTypeAndName(type: ResourceType, name: string): Promise<ResourceMapping | null>;
  listByType(type: ResourceType): Promise<ResourceMapping[]>;
  listAll(): Promise<ResourceMapping[]>;
}

// --- Port ---

export interface CloudShareResourceLister {
  listProjects(): Promise<Array<{ id: string; name: string }>>;
  listRegions(): Promise<Array<{ id: string; name: string }>>;
  listBlueprints(): Promise<Array<{ id: string; name: string }>>;
  listPolicies(): Promise<Array<{ id: string; name: string }>>;
}

// --- Use case ---

export interface SyncResourcesDeps {
  readonly lister: CloudShareResourceLister;
  readonly repository: ResourceRepository;
  readonly now?: () => Date;
}

export interface SyncResourcesResult {
  readonly synced: number;
  readonly byType: Record<ResourceType, ResourceMapping[]>;
}

export async function syncResources(deps: SyncResourcesDeps): Promise<SyncResourcesResult> {
  const getNow = deps.now ?? (() => new Date());

  const [projects, regions, blueprints, policies] = await Promise.all([
    deps.lister.listProjects(),
    deps.lister.listRegions(),
    deps.lister.listBlueprints(),
    deps.lister.listPolicies(),
  ]);

  async function saveAll(
    type: ResourceType,
    items: Array<{ id: string; name: string }>,
  ): Promise<ResourceMapping[]> {
    const mappings: ResourceMapping[] = items.map((item) => ({
      type,
      name: item.name,
      cloudshareId: item.id,
      syncedAt: getNow(),
    }));
    for (const m of mappings) {
      await deps.repository.save(m);
    }
    return mappings;
  }

  const [pm, rm, bm, polm] = await Promise.all([
    saveAll("project", projects),
    saveAll("region", regions),
    saveAll("blueprint", blueprints),
    saveAll("policy", policies),
  ]);

  const byType: Record<ResourceType, ResourceMapping[]> = {
    project: pm,
    region: rm,
    blueprint: bm,
    policy: polm,
  };

  return {
    synced: pm.length + rm.length + bm.length + polm.length,
    byType,
  };
}
