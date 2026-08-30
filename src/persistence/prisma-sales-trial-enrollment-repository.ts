import type { PrismaClient } from "@prisma/client";
import type {
  SalesTrialEnrollment,
  SalesTrialEnrollmentRepository,
} from "@/domain/sales-trial-enrollment";

export function createPrismaSalesTrialEnrollmentRepository(
  prisma: PrismaClient,
): SalesTrialEnrollmentRepository {
  return {
    async save(enrollment) {
      await prisma.salesTrialEnrollment.upsert({
        where: { id: enrollment.id },
        create: serialize(enrollment),
        update: serialize(enrollment),
      });
    },
    async findByOfferingAndPortalUser(customerId, salesTrialOfferingId, portalUserId) {
      const row = await prisma.salesTrialEnrollment.findUnique({
        where: {
          customerId_salesTrialOfferingId_portalUserId: {
            customerId,
            salesTrialOfferingId,
            portalUserId,
          },
        },
      });
      return row ? hydrate(row) : null;
    },
    async listByOffering(customerId, salesTrialOfferingId) {
      return (
        await prisma.salesTrialEnrollment.findMany({
          where: { customerId, salesTrialOfferingId },
          orderBy: { createdAt: "asc" },
        })
      ).map(hydrate);
    },
  };
}

function serialize(enrollment: SalesTrialEnrollment) {
  return {
    id: enrollment.id,
    customerId: enrollment.customerId,
    salesTrialOfferingId: enrollment.salesTrialOfferingId,
    portalUserId: enrollment.portalUserId,
    email: enrollment.email,
    firstName: enrollment.firstName,
    lastName: enrollment.lastName,
    cloudShareParticipantId: enrollment.cloudShareParticipantId,
    cloudShareRosterEnvironmentReference: enrollment.cloudShareRosterEnvironmentReference,
    environmentStatus: enrollment.environmentStatus,
    firstJoined: enrollment.firstJoined,
    status: enrollment.status,
    attentionReason: enrollment.attentionReason,
    lastLaunchedAt: enrollment.lastLaunchedAt,
    lastReconciledAt: enrollment.lastReconciledAt,
    createdAt: enrollment.createdAt,
    updatedAt: enrollment.updatedAt,
  };
}

function hydrate(row: {
  id: string;
  customerId: string;
  salesTrialOfferingId: string;
  portalUserId: string;
  email: string;
  firstName: string;
  lastName: string;
  cloudShareParticipantId: string | null;
  cloudShareRosterEnvironmentReference: string | null;
  environmentStatus: string | null;
  firstJoined: string | null;
  status: string;
  attentionReason: string | null;
  lastLaunchedAt: Date | null;
  lastReconciledAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): SalesTrialEnrollment {
  return {
    ...row,
    status:
      row.status === "provisioning" || row.status === "needs_attention"
        ? row.status
        : "active",
  };
}
