import type { PrismaClient } from "@prisma/client";
import type { DemoItem, DemoItemRepository } from "@/domain/demo-item";

export function createPrismaDemoItemRepository(prisma: PrismaClient): DemoItemRepository {
  return {
    async save(item) {
      await prisma.demoItem.upsert({ where: { id: item.id }, create: serialize(item), update: serialize(item) });
    },
    async findById(id) { const row = await prisma.demoItem.findUnique({ where: { id } }); return row ? hydrate(row) : null; },
    async listByCustomerId(customerId) { return (await prisma.demoItem.findMany({ where: { customerId }, orderBy: { createdAt: "desc" } })).map(hydrate); },
  };
}

function serialize(item: DemoItem) { return { id: item.id, customerId: item.customerId, name: item.name, description: item.description, projectId: item.project.id, projectName: item.project.name, blueprintsJson: JSON.stringify(item.blueprints), policyId: item.policy.id, policyName: item.policy.name, regionId: item.region.id, regionName: item.region.name, salesExperienceType: item.salesExperienceType, defaultDurationMinutes: item.defaultDurationMinutes, status: item.status, archivedAt: item.archivedAt, createdAt: item.createdAt, updatedAt: item.updatedAt }; }
function hydrate(row: { id: string; customerId: string; name: string; description: string; projectId: string; projectName: string; blueprintsJson: string; policyId: string; policyName: string; regionId: string; regionName: string; salesExperienceType: string; defaultDurationMinutes: number; status: string; archivedAt: Date | null; createdAt: Date; updatedAt: Date }): DemoItem { return { id: row.id, customerId: row.customerId, name: row.name, description: row.description, project: { id: row.projectId, name: row.projectName }, blueprints: JSON.parse(row.blueprintsJson), policy: { id: row.policyId, name: row.policyName }, region: { id: row.regionId, name: row.regionName }, salesExperienceType: row.salesExperienceType as DemoItem["salesExperienceType"], defaultDurationMinutes: row.defaultDurationMinutes, status: row.status as DemoItem["status"], archivedAt: row.archivedAt, createdAt: row.createdAt, updatedAt: row.updatedAt }; }
