import type { PrismaClient } from "@prisma/client";
import type { CohortExamSession, CohortExamSessionRepository } from "@/domain/cohort-exam-session";

export function createPrismaCohortExamSessionRepository(prisma: PrismaClient): CohortExamSessionRepository {
  return {
    async save(session: CohortExamSession): Promise<void> {
      await prisma.cohortExamSession.upsert({
        where: { id: session.id },
        update: serialize(session),
        create: serialize(session),
      });
    },
    async findById(id: string): Promise<CohortExamSession | null> {
      const row = await prisma.cohortExamSession.findUnique({ where: { id } });
      return row ? hydrate(row) : null;
    },
    async listByExamId(examId: string): Promise<CohortExamSession[]> {
      const rows = await prisma.cohortExamSession.findMany({
        where: { examId },
        orderBy: [{ createdAt: "desc" }],
      });
      return rows.map(hydrate);
    },
    async claimDraftForPublishing(input): Promise<CohortExamSession | null> {
      const claimed = await prisma.cohortExamSession.updateMany({
        where: {
          id: input.id,
          customerId: input.customerId,
          examId: input.examId,
          status: "draft",
        },
        data: {
          status: "publishing",
          updatedAt: input.claimedAt,
        },
      });
      if (claimed.count !== 1) {
        return null;
      }
      const row = await prisma.cohortExamSession.findUnique({ where: { id: input.id } });
      return row ? hydrate(row) : null;
    },
  };
}

function serialize(session: CohortExamSession) {
  return {
    id: session.id,
    customerId: session.customerId,
    examId: session.examId,
    name: session.name,
    admissionStartsAt: session.admissionStartsAt,
    admissionEndsAt: session.admissionEndsAt,
    capacity: session.capacity,
    status: session.status,
    cloudShareTrainingId: session.cloudShareTrainingId ?? null,
    cloudShareExperienceId: session.cloudShareExperienceId ?? null,
    cloudShareTeamId: session.cloudShareTeamId ?? null,
    publishedAt: session.publishedAt ?? null,
    admissionClosedAt: session.admissionClosedAt ?? null,
    retiredAt: session.retiredAt ?? null,
    lastPublishError: session.lastPublishError ?? null,
    lastPublishCorrelationId: session.lastPublishCorrelationId ?? null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function hydrate(row: {
  id: string;
  customerId: string;
  examId: string;
  name: string;
  admissionStartsAt: Date;
  admissionEndsAt: Date | null;
  capacity: number | null;
  status: string;
  cloudShareTrainingId?: string | null;
  cloudShareExperienceId?: string | null;
  cloudShareTeamId?: string | null;
  publishedAt?: Date | null;
  admissionClosedAt?: Date | null;
  retiredAt?: Date | null;
  lastPublishError?: string | null;
  lastPublishCorrelationId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}): CohortExamSession {
  return {
    id: row.id,
    customerId: row.customerId,
    examId: row.examId,
    name: row.name,
    admissionStartsAt: row.admissionStartsAt,
    admissionEndsAt: row.admissionEndsAt,
    capacity: row.capacity,
    status: row.status as CohortExamSession["status"],
    cloudShareTrainingId: row.cloudShareTrainingId ?? null,
    cloudShareExperienceId: row.cloudShareExperienceId ?? null,
    cloudShareTeamId: row.cloudShareTeamId ?? null,
    publishedAt: row.publishedAt ?? null,
    admissionClosedAt: row.admissionClosedAt ?? null,
    retiredAt: row.retiredAt ?? null,
    lastPublishError: row.lastPublishError ?? null,
    lastPublishCorrelationId: row.lastPublishCorrelationId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
