import type { PrismaClient } from "@prisma/client";
import type {
  AdminMonitoringAttemptRepository,
  MonitoringAttemptRecord,
} from "@/domain/admin-monitoring";

export function createPrismaAdminMonitoringAttemptRepository(
  prisma: PrismaClient,
): AdminMonitoringAttemptRepository {
  return {
    async listByCustomerId(customerId: string): Promise<MonitoringAttemptRecord[]> {
      const rows = await prisma.examAttempt.findMany({
        where: { customerId },
        include: {
          exam: true,
          labLaunch: true,
        },
        orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      });

      const candidateIds = [...new Set(rows.map((row) => row.candidateId))];
      const users = await prisma.user.findMany({
        where: { id: { in: candidateIds } },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      });
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
          status: row.status as MonitoringAttemptRecord["status"],
          scheduledFor: row.scheduledFor,
          createdAt: row.createdAt,
          trainingId: row.labLaunch?.trainingId ?? null,
          experienceId: row.labLaunch?.experienceId ?? null,
          environmentExternalId: row.labLaunch?.environmentExternalId ?? null,
          participantId: row.labLaunch?.participantId ?? null,
          scoreRetrievalEnabled: row.exam.scoreRetrievalEnabled,
        };
      });
    },
  };
}
