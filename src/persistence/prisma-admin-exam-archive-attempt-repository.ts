import type { PrismaClient } from "@prisma/client";
import type { AdminExamArchiveAttemptRepository } from "@/api/admin-exam-archive-runtime";

export function createPrismaAdminExamArchiveAttemptRepository(
  prisma: PrismaClient,
): AdminExamArchiveAttemptRepository {
  return {
    async listByExamId(customerId: string, examId: string) {
      return prisma.examAttempt.findMany({
        where: { customerId, examId },
        select: {
          id: true,
          status: true,
          cohortSessionId: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
    },
  };
}
