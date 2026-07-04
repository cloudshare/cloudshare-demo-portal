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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
