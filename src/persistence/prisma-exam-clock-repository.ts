import type { PrismaClient } from "@prisma/client";
import type { ExamClockRepository, ExamClockState } from "@/domain/exam-clock";

export function createPrismaExamClockRepository(prisma: PrismaClient): ExamClockRepository {
  return {
    async findByExamAttemptId(examAttemptId: string): Promise<ExamClockState | null> {
      const row = await prisma.examClock.findUnique({ where: { examAttemptId } });
      if (!row) {
        return null;
      }
      return {
        examAttemptId: row.examAttemptId,
        status: row.status as ExamClockState["status"],
        elapsedAtPauseMs: row.elapsedAtPauseMs,
        startedAt: row.startedAt,
        updatedAt: row.updatedAt,
      };
    },

    async save(state: ExamClockState): Promise<void> {
      await prisma.examClock.upsert({
        where: { examAttemptId: state.examAttemptId },
        update: {
          status: state.status,
          elapsedAtPauseMs: state.elapsedAtPauseMs,
          startedAt: state.startedAt,
          updatedAt: state.updatedAt,
        },
        create: {
          examAttemptId: state.examAttemptId,
          status: state.status,
          elapsedAtPauseMs: state.elapsedAtPauseMs,
          startedAt: state.startedAt,
          updatedAt: state.updatedAt,
        },
      });
    },
  };
}
