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
    async reserveForLaunch(enrollment) {
      try {
        const created = await prisma.salesTrialEnrollment.create({
          data: serialize(enrollment),
        });
        return {
          enrollment: hydrate(created as unknown as SalesTrialEnrollmentRow),
          created: true,
          reclaimed: false,
        } as const;
      } catch (error) {
        if (!isLaunchReservationConflict(error)) {
          throw error;
        }
        const reclaimed = await prisma.salesTrialEnrollment.updateMany({
          where: {
            customerId: enrollment.customerId,
            salesTrialOfferingId: enrollment.salesTrialOfferingId,
            portalUserId: enrollment.portalUserId,
            status: "retryable_failure",
            cloudShareParticipantId: null,
          },
          data: {
            status: "provisioning",
            attentionReason: null,
            lastReconciledAt: enrollment.lastReconciledAt,
            updatedAt: enrollment.updatedAt,
          },
        });
        const existing = await prisma.salesTrialEnrollment.findUnique({
          where: {
            customerId_salesTrialOfferingId_portalUserId: {
              customerId: enrollment.customerId,
              salesTrialOfferingId: enrollment.salesTrialOfferingId,
              portalUserId: enrollment.portalUserId,
            },
          },
        });
        if (!existing) {
          throw error;
        }
        return {
          enrollment: hydrate(existing as unknown as SalesTrialEnrollmentRow),
          created: false,
          reclaimed: reclaimed.count === 1,
        } as const;
      }
    },
    async reserveForExtension(customerId, enrollmentId, update) {
      const reserved = await prisma.salesTrialEnrollment.updateMany({
        where: {
          customerId,
          id: enrollmentId,
          status: "active",
          attentionReason: null,
        },
        data: {
          status: "needs_attention",
          attentionReason: update.attentionReason,
          updatedAt: update.updatedAt,
        },
      });
      return reserved.count === 1;
    },
    async releaseExtensionReservation(customerId, enrollmentId, update) {
      const released = await prisma.salesTrialEnrollment.updateMany({
        where: {
          customerId,
          id: enrollmentId,
          status: "needs_attention",
          attentionReason: update.expectedAttentionReason,
        },
        data: {
          status: "active",
          attentionReason: null,
          updatedAt: update.updatedAt,
        },
      });
      return released.count === 1;
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
      return row ? hydrate(row as unknown as SalesTrialEnrollmentRow) : null;
    },
    async findById(customerId, enrollmentId) {
      const row = await prisma.salesTrialEnrollment.findUnique({
        where: { id: enrollmentId },
      });
      return row && row.customerId === customerId
        ? hydrate(row as unknown as SalesTrialEnrollmentRow)
        : null;
    },
    async listByOffering(customerId, salesTrialOfferingId) {
      return (
        await prisma.salesTrialEnrollment.findMany({
          where: { customerId, salesTrialOfferingId },
          orderBy: { createdAt: "asc" },
        })
      ).map((row: unknown) => hydrate(row as SalesTrialEnrollmentRow));
    },
    async listByPortalUser(customerId, portalUserId) {
      return (
        await prisma.salesTrialEnrollment.findMany({
          where: { customerId, portalUserId },
          orderBy: { createdAt: "asc" },
        })
      ).map((row: unknown) => hydrate(row as SalesTrialEnrollmentRow));
    },
  };
}

function isLaunchReservationConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002" &&
    Array.isArray((error as { meta?: { target?: unknown } }).meta?.target) &&
    JSON.stringify((error as { meta?: { target?: unknown } }).meta?.target) ===
      JSON.stringify(["customerId", "salesTrialOfferingId", "portalUserId"])
  );
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
    invitationStatus: enrollment.invitationStatus ?? "notSent",
    participationStatus: enrollment.participationStatus ?? "pending",
    cloudShareRosterEnvironmentReference: enrollment.cloudShareRosterEnvironmentReference,
    environmentStatus: enrollment.environmentStatus,
    v4EnvironmentStatus: enrollment.v4EnvironmentStatus, v4EnvironmentObservedAt: enrollment.v4EnvironmentObservedAt,
    observedExpirationTime: enrollment.observedExpirationTime ?? null,
    firstJoined: enrollment.firstJoined,
    status: enrollment.status,
    attentionReason: enrollment.attentionReason,
    lastLaunchedAt: enrollment.lastLaunchedAt,
    lastReconciledAt: enrollment.lastReconciledAt,
    createdAt: enrollment.createdAt,
    updatedAt: enrollment.updatedAt,
  };
}

type SalesTrialEnrollmentRow = {
  id: string;
  customerId: string;
  salesTrialOfferingId: string;
  portalUserId: string;
  email: string;
  firstName: string;
  lastName: string;
  cloudShareParticipantId: string | null;
  invitationStatus: string;
  participationStatus: string;
  cloudShareRosterEnvironmentReference: string | null;
  environmentStatus: string | null;
  v4EnvironmentStatus?: string | null; v4EnvironmentObservedAt?: Date | null;
  observedExpirationTime: string | null;
  firstJoined: string | null;
  status: string;
  attentionReason: string | null;
  lastLaunchedAt: Date | null;
  lastReconciledAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

function hydrate(row: SalesTrialEnrollmentRow): SalesTrialEnrollment {
  return {
    ...row,
    invitationStatus: row.invitationStatus === "sent" ? "sent" : "notSent",
    participationStatus:
      row.participationStatus === "inProgress" ||
      row.participationStatus === "concluded"
        ? row.participationStatus
        : "pending",
    status:
      row.status === "provisioning" ||
      row.status === "needs_attention" ||
      row.status === "retryable_failure"
        ? row.status
        : "active",
  };
}
