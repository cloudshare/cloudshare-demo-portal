import type { PrismaClient } from "@prisma/client";
import type {
  AdminCohortExamSessionAttemptRecord,
  AdminCohortExamSessionAttemptRepository,
} from "@/api/admin-cohort-exam-session-detail";

export function createPrismaAdminCohortExamSessionAttemptRepository(
  prisma: PrismaClient,
): AdminCohortExamSessionAttemptRepository {
  return {
    async listBySessionId(
      customerId: string,
      sessionId: string,
    ): Promise<readonly AdminCohortExamSessionAttemptRecord[]> {
      const rows: Array<{
        id: string;
        customerId: string;
        candidateId: string;
        examId: string;
        status: string;
        scheduledFor: Date | null;
        createdAt: Date;
        exam: {
          title: string;
        };
        labLaunch: {
          trainingId: string | null;
          experienceId: string | null;
          environmentExternalId: string | null;
          environmentId: string | null;
          participantId: string | null;
        } | null;
      }> = await prisma.examAttempt.findMany({
        where: {
          customerId,
          cohortSessionId: sessionId,
        },
        include: {
          exam: true,
          labLaunch: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });

      const candidateIds = [...new Set(rows.map((row) => row.candidateId))];
      const users: Array<{
        id: string;
        email: string;
        firstName: string | null;
        lastName: string | null;
      }> = candidateIds.length
        ? await prisma.user.findMany({
            where: {
              customerId,
              id: { in: candidateIds },
            },
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          })
        : [];
      const usersById = new Map(users.map((user) => [user.id, user]));

      return rows.map((row) => {
        const candidate = usersById.get(row.candidateId);
        return {
          id: row.id,
          customerId: row.customerId,
          candidateId: row.candidateId,
          candidateEmail: candidate?.email ?? row.candidateId,
          candidateFirstName: candidate?.firstName ?? null,
          candidateLastName: candidate?.lastName ?? null,
          examId: row.examId,
          examTitle: row.exam.title,
          status: row.status as AdminCohortExamSessionAttemptRecord["status"],
          scheduledFor: row.scheduledFor,
          createdAt: row.createdAt,
          trainingId: row.labLaunch?.trainingId ?? null,
          experienceId: row.labLaunch?.experienceId ?? null,
          environmentExternalId: row.labLaunch?.environmentExternalId ?? null,
          environmentId: row.labLaunch?.environmentId ?? null,
          participantId: row.labLaunch?.participantId ?? null,
        };
      });
    },
  };
}
