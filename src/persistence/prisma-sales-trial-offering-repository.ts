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
    async reservePublication(customerId, id, update) {
      const result = await prisma.salesTrialOffering.updateMany({
        where: {
          customerId,
          id,
          status: "draft",
          cloudShareSalesExperienceId: null,
          externalId: null,
        },
        data: {
          externalId: update.externalId,
          status: "provisioning",
          updatedAt: update.updatedAt,
          attentionReason: update.attentionReason,
        },
      });
      return result.count === 1;
    },
    async releasePublicationReservation(customerId, id, update) {
      const result = await prisma.salesTrialOffering.updateMany({
        where: {
          customerId,
          id,
          status: "provisioning",
          cloudShareSalesExperienceId: null,
        },
        data: {
          externalId: null,
          status: "draft",
          updatedAt: update.updatedAt,
          attentionReason: update.attentionReason,
        },
      });
      return result.count === 1;
    },
    async markPublishNeedsAttention(customerId, id, update) {
      const result = await prisma.salesTrialOffering.updateMany({
        where: { customerId, id },
        data: {
          cloudShareSalesExperienceId: update.cloudShareSalesExperienceId,
          externalId: update.externalId,
          salesProDisplayName: update.salesProDisplayName,
          status: "needs_attention",
          updatedAt: update.updatedAt,
          publishedAt: update.publishedAt,
          attentionReason: update.attentionReason,
        },
      });
      return result.count === 1;
    },
    async markEndNeedsAttention(customerId, id, update) {
      const result = await prisma.salesTrialOffering.updateMany({
        where: { customerId, id },
        data: {
          end: update.end,
          status: "needs_attention",
          updatedAt: update.updatedAt,
          unpublishedAt: update.unpublishedAt,
          attentionReason: update.attentionReason,
        },
      });
      return result.count === 1;
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
  end: string | null;
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
      row.status === "provisioning" ||
      row.status === "published" ||
      row.status === "unpublished" ||
      row.status === "needs_attention"
        ? row.status
        : "draft",
  };
}
