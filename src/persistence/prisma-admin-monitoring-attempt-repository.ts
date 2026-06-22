import type { PrismaClient } from "@prisma/client";
import type {
  AdminMonitoringAttemptRepository,
  AdminMonitoringHistoryPageRequest,
  AdminMonitoringSummary,
  MonitoringAttemptPage,
  MonitoringAttemptRecord,
} from "@/domain/admin-monitoring";

const CURRENT_ATTEMPT_STATUSES = ["scheduled", "ready", "in_progress", "suspended"] as const;
const TERMINAL_ATTEMPT_STATUSES = ["completed", "expired"] as const;

export function createPrismaAdminMonitoringAttemptRepository(
  prisma: PrismaClient,
): AdminMonitoringAttemptRepository {
  return {
    async countSummaryByCustomerId(customerId: string): Promise<AdminMonitoringSummary> {
      const grouped = await prisma.examAttempt.groupBy({
        by: ["status"],
        where: { customerId },
        _count: {
          _all: true,
        },
      });

      return {
        scheduled: findStatusCount(grouped, "scheduled"),
        ready: findStatusCount(grouped, "ready"),
        inProgress: findStatusCount(grouped, "in_progress"),
        suspended: findStatusCount(grouped, "suspended"),
        completed: findStatusCount(grouped, "completed"),
        expired: findStatusCount(grouped, "expired"),
      };
    },

    async listCurrentByCustomerId(customerId: string): Promise<MonitoringAttemptRecord[]> {
      const rows = await prisma.examAttempt.findMany({
        where: {
          customerId,
          status: {
            in: [...CURRENT_ATTEMPT_STATUSES],
          },
        },
        include: {
          exam: true,
          labLaunch: true,
        },
        orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      });

      return mapAttemptRows(prisma, customerId, rows);
    },

    async listHistoryPageByCustomerId(
      customerId: string,
      page: AdminMonitoringHistoryPageRequest,
    ): Promise<MonitoringAttemptPage> {
      const [total, rows] = await Promise.all([
        prisma.examAttempt.count({
          where: {
            customerId,
            status: {
              in: [...TERMINAL_ATTEMPT_STATUSES],
            },
          },
        }),
        prisma.examAttempt.findMany({
          where: {
            customerId,
            status: {
              in: [...TERMINAL_ATTEMPT_STATUSES],
            },
          },
          include: {
            exam: true,
            labLaunch: true,
          },
          orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          take: page.limit,
          skip: page.offset,
        }),
      ]);

      return {
        attempts: await mapAttemptRows(prisma, customerId, rows),
        total,
        limit: page.limit,
        offset: page.offset,
      };
    },
  };
}

async function mapAttemptRows(
  prisma: PrismaClient,
  customerId: string,
  rows: Array<{
    id: string;
    customerId: string;
    candidateId: string;
    examId: string;
    status: string;
    scheduledFor: Date | null;
    createdAt: Date;
    exam: {
      title: string;
      scoreRetrievalEnabled: boolean;
    };
    labLaunch: {
      trainingId: string | null;
      experienceId: string | null;
      environmentExternalId: string | null;
      participantId: string | null;
    } | null;
  }>,
): Promise<MonitoringAttemptRecord[]> {
  const candidateIds = [...new Set(rows.map((row) => row.candidateId))];
  const users = candidateIds.length
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
}

function findStatusCount(
  grouped: Array<{ status: string; _count: { _all: number } }>,
  status: string,
): number {
  return grouped.find((row) => row.status === status)?._count._all ?? 0;
}
