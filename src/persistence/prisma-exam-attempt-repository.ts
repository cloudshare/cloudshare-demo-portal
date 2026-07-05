import type { PrismaClient } from "@prisma/client";
import type { ExamAttempt, ExamAttemptRepository } from "@/domain/exam-attempt";

export function createPrismaExamAttemptRepository(prisma: PrismaClient): ExamAttemptRepository {
  return {
    async save(attempt: ExamAttempt): Promise<void> {
      await prisma.examAttempt.upsert({
        where: { id: attempt.id },
        update: {
          customerId: attempt.customerId ?? "",
          candidateId: attempt.candidateId,
          examId: attempt.examId,
          cohortSessionId: attempt.cohortSessionId ?? null,
          status: attempt.status,
          scheduledFor: attempt.scheduledFor ?? null,
          createdAt: attempt.createdAt,
        },
        create: {
          id: attempt.id,
          customerId: attempt.customerId ?? "",
          candidateId: attempt.candidateId,
          examId: attempt.examId,
          cohortSessionId: attempt.cohortSessionId ?? null,
          status: attempt.status,
          scheduledFor: attempt.scheduledFor ?? null,
          createdAt: attempt.createdAt,
        },
      });
    },

    async findById(id: string): Promise<ExamAttempt | null> {
      const row = await prisma.examAttempt.findUnique({ where: { id } });
      return row ? toDomain(row) : null;
    },

    async listByCandidate(candidateId: string): Promise<ExamAttempt[]> {
      const rows = await prisma.examAttempt.findMany({
        where: { candidateId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      return rows.map(toDomain);
    },

    async delete(id: string): Promise<void> {
      await prisma.examAttempt.deleteMany({ where: { id } });
    },
  };
}

function toDomain(row: {
  id: string;
  customerId: string;
  candidateId: string;
  examId: string;
  cohortSessionId: string | null;
  status: string;
  scheduledFor: Date | null;
  createdAt: Date;
}): ExamAttempt {
  return {
    id: row.id,
    customerId: row.customerId,
    candidateId: row.candidateId,
    examId: row.examId,
    cohortSessionId: row.cohortSessionId ?? undefined,
    status: row.status as ExamAttempt["status"],
    scheduledFor: row.scheduledFor ?? undefined,
    createdAt: row.createdAt,
  };
}
