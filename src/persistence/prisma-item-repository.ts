import type { PrismaClient } from "@prisma/client";
import type { Item, ItemRepository } from "@/domain/item";

export function createPrismaItemRepository(prisma: PrismaClient): ItemRepository {
  return {
    async save(item) {
      await prisma.item.upsert({ where: { id: item.id }, create: serialize(item), update: serialize(item) });
    },
    async findById(id) { const row = await prisma.item.findUnique({ where: { id } }); return row ? hydrate(row) : null; },
    async listByCustomerId(customerId) { return (await prisma.item.findMany({ where: { customerId }, orderBy: { createdAt: "desc" } })).map(hydrate); },
  };
}

function serialize(item: Item) { return { id: item.id, customerId: item.customerId, name: item.name, description: item.description, projectId: item.project.id, projectName: item.project.name, blueprintsJson: JSON.stringify(item.blueprints), policyId: item.policy.id, policyName: item.policy.name, regionsJson: JSON.stringify(item.regions), salesExperienceType: item.salesExperienceType, defaultDurationMinutes: item.defaultDurationMinutes, status: item.status, archivedAt: item.archivedAt, createdAt: item.createdAt, updatedAt: item.updatedAt }; }
function hydrate(row: { id: string; customerId: string; name: string; description: string; projectId: string; projectName: string; blueprintsJson: string; policyId: string; policyName: string; regionsJson: string; salesExperienceType: string; defaultDurationMinutes: number; status: string; archivedAt: Date | null; createdAt: Date; updatedAt: Date }): Item { return { id: row.id, customerId: row.customerId, name: row.name, description: row.description, project: { id: row.projectId, name: row.projectName }, blueprints: JSON.parse(row.blueprintsJson), policy: { id: row.policyId, name: row.policyName }, regions: JSON.parse(row.regionsJson), salesExperienceType: row.salesExperienceType as Item["salesExperienceType"], defaultDurationMinutes: row.defaultDurationMinutes, status: row.status as Item["status"], archivedAt: row.archivedAt, createdAt: row.createdAt, updatedAt: row.updatedAt }; }
