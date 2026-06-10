import type { ResourceMapping, ResourceRepository, ResourceType } from "@/domain/resource-sync";

export function createInMemoryResourceRepository(): ResourceRepository {
  // Keyed by "type:name" to allow natural overwrite on re-sync.
  const store = new Map<string, ResourceMapping>();

  function key(type: ResourceType, name: string): string {
    return `${type}:${name}`;
  }

  return {
    async save(mapping: ResourceMapping): Promise<void> {
      store.set(key(mapping.type, mapping.name), mapping);
    },

    async findByTypeAndName(type: ResourceType, name: string): Promise<ResourceMapping | null> {
      return store.get(key(type, name)) ?? null;
    },

    async listByType(type: ResourceType): Promise<ResourceMapping[]> {
      return [...store.values()].filter((m) => m.type === type);
    },

    async listAll(): Promise<ResourceMapping[]> {
      return [...store.values()];
    },
  };
}
