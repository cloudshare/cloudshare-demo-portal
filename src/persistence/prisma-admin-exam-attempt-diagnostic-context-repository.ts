import type { PrismaClient } from "@prisma/client";
import type {
  AdminExamAttemptDiagnosticContextRecord,
  AdminExamAttemptDiagnosticContextRepository,
} from "@/domain/admin-exam-attempt-diagnostics";

export function createPrismaAdminExamAttemptDiagnosticContextRepository(
  prisma: PrismaClient,
): AdminExamAttemptDiagnosticContextRepository {
  return {
    async findByExamAttemptId(
      customerId: string,
      examAttemptId: string,
    ): Promise<AdminExamAttemptDiagnosticContextRecord | null> {
      const row = await prisma.examAttempt.findFirst({
        where: {
          id: examAttemptId,
          customerId,
        },
        include: {
          exam: {
            select: {
              id: true,
              customerId: true,
              title: true,
              status: true,
              scoreRetrievalEnabled: true,
            },
          },
          labLaunch: true,
        },
      });

      if (!row) {
        return null;
      }

      if (row.exam.customerId !== customerId) {
        return null;
      }

      const candidate = await prisma.user.findFirst({
        where: {
          id: row.candidateId,
          customerId,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      });

      return {
        attemptId: row.id,
        customerId: row.customerId,
        attemptStatus: row.status,
        scheduledFor: row.scheduledFor,
        createdAt: row.createdAt,
        candidateId: row.candidateId,
        candidateEmail: candidate?.email ?? row.candidateId,
        candidateFirstName: candidate?.firstName ?? null,
        candidateLastName: candidate?.lastName ?? null,
        examId: row.examId,
        examTitle: row.exam.title,
        examStatus: row.exam.status,
        scoreRetrievalEnabled: row.exam.scoreRetrievalEnabled,
        trainingId: row.labLaunch?.trainingId ?? null,
        experienceId: row.labLaunch?.experienceId ?? null,
        environmentExternalId: row.labLaunch?.environmentExternalId ?? null,
        environmentId: row.labLaunch?.environmentId ?? null,
        participantId: row.labLaunch?.participantId ?? null,
        participantEmail: row.labLaunch?.participantEmail ?? null,
      };
    },
  };
}
