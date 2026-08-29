import type { PrismaClient } from "@prisma/client";
import type {
  SalesTrialOffering,
  SalesTrialOfferingRepository,
} from "@/domain/sales-trial-offering";

export function createPrismaSalesTrialOfferingRepository(
  prisma: PrismaClient,
): SalesTrialOfferingRepository {
  return {
    async save(offering) {
      await prisma.salesTrialOffering.upsert({
        where: { id: offering.id },
        create: serialize(offering),
        update: serialize(offering),
      });
    },
    async findById(customerId, id) {
      const row = await prisma.salesTrialOffering.findFirst({ where: { customerId, id } });
      return row ? hydrate(row) : null;
    },
    async listByCustomerId(customerId) {
      return (
        await prisma.salesTrialOffering.findMany({
          where: { customerId },
          orderBy: { createdAt: "desc" },
        })
      ).map(hydrate);
    },
    async listPublishedByCustomerId(customerId) {
      return (
        await prisma.salesTrialOffering.findMany({
          where: { customerId, status: "published" },
          orderBy: { publishedAt: "desc" },
        })
      ).map(hydrate);
    },
  };
}

function serialize(offering: SalesTrialOffering) {
  return {
    id: offering.id,
    customerId: offering.customerId,
    itemId: offering.itemId,
    title: offering.title,
    description: offering.description,
    cloudShareSalesExperienceId: offering.cloudShareSalesExperienceId,
    externalId: offering.externalId,
    start: offering.start,
    end: offering.end,
    timeZone: offering.timeZone,
    salesProEmail: offering.salesProEmail,
    salesProDisplayName: offering.salesProDisplayName,
    status: offering.status,
    attentionReason: offering.attentionReason,
    createdAt: offering.createdAt,
    updatedAt: offering.updatedAt,
    publishedAt: offering.publishedAt,
    unpublishedAt: offering.unpublishedAt,
  };
}

function hydrate(row: {
  id: string;
  customerId: string;
  itemId: string;
  title: string;
  description: string;
  cloudShareSalesExperienceId: string | null;
  externalId: string | null;
  start: string;
  end: string;
  timeZone: string;
  salesProEmail: string;
  salesProDisplayName: string | null;
  status: string;
  attentionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
  unpublishedAt: Date | null;
}): SalesTrialOffering {
  return {
    ...row,
    status:
      row.status === "published" ||
      row.status === "unpublished" ||
      row.status === "needs_attention"
        ? row.status
        : "draft",
  };
}
