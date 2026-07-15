import type { PrismaClient } from "@prisma/client";
import type { SalesSessionConfigurationRepository } from "@/domain/sales-session-configuration";

export function createPrismaSalesSessionConfigurationRepository(prisma: PrismaClient): SalesSessionConfigurationRepository {
  return { async find(customerId) { const row = await prisma.customer.findUnique({ where: { id: customerId }, select: { salesSessionNameTemplate: true } }); return row ? { template: row.salesSessionNameTemplate } : null; }, async save(customerId, template) { await prisma.customer.update({ where: { id: customerId }, data: { salesSessionNameTemplate: template } }); } };
}
