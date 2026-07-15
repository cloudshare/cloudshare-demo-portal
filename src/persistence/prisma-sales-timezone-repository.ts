import type { PrismaClient } from "@prisma/client";
import type { SalesAdminPreferenceRepository, SalesTimezoneCacheRepository } from "@/domain/sales-timezones";

export function createPrismaSalesTimezoneCacheRepository(prisma: PrismaClient): SalesTimezoneCacheRepository {
  return {
    async find(customerId) { const row = await prisma.salesTimezoneCache.findUnique({ where: { customerId } }); return row ? { customerId, timezones: JSON.parse(row.valuesJson), fetchedAt: row.fetchedAt } : null; },
    async save(entry) { await prisma.salesTimezoneCache.upsert({ where: { customerId: entry.customerId }, create: { customerId: entry.customerId, valuesJson: JSON.stringify(entry.timezones), fetchedAt: entry.fetchedAt }, update: { valuesJson: JSON.stringify(entry.timezones), fetchedAt: entry.fetchedAt } }); },
  };
}

export function createPrismaSalesAdminPreferenceRepository(prisma: PrismaClient): SalesAdminPreferenceRepository {
  return {
    async find(userId) { const user = await prisma.user.findUnique({ where: { id: userId }, select: { lastSalesTimeZone: true, lastSalesExperienceType: true } }); return { timeZone: user?.lastSalesTimeZone ?? null, experienceType: user?.lastSalesExperienceType as "demo" | "poc" | "pov" | "trial" | null ?? null }; },
    async save(userId, preference) { await prisma.user.update({ where: { id: userId }, data: { lastSalesTimeZone: preference.timeZone, lastSalesExperienceType: preference.experienceType } }); },
  };
}
