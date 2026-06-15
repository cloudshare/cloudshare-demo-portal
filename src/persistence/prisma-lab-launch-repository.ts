import type { PrismaClient } from "@prisma/client";
import type { LabLaunch, LabLaunchRepository } from "@/domain/lab-launch";

export function createPrismaLabLaunchRepository(prisma: PrismaClient): LabLaunchRepository {
  return {
    async save(launch: LabLaunch): Promise<void> {
      await prisma.labLaunch.upsert({
        where: { id: launch.id },
        update: {
          examAttemptId: launch.examAttemptId,
          candidateId: launch.candidateId,
          participantEmail: launch.participantEmail ?? null,
          trainingId: launch.trainingId ?? null,
          experienceId: launch.experienceId,
          environmentExternalId: launch.environmentExternalId ?? null,
          environmentId: launch.environmentId ?? null,
          loginUrl: launch.loginUrl,
          status: launch.status,
          createdAt: launch.createdAt,
        },
        create: {
          id: launch.id,
          examAttemptId: launch.examAttemptId,
          candidateId: launch.candidateId,
          participantEmail: launch.participantEmail ?? null,
          trainingId: launch.trainingId ?? null,
          experienceId: launch.experienceId,
          environmentExternalId: launch.environmentExternalId ?? null,
          environmentId: launch.environmentId ?? null,
          loginUrl: launch.loginUrl,
          status: launch.status,
          createdAt: launch.createdAt,
        },
      });
    },

    async findById(id: string): Promise<LabLaunch | null> {
      const row = await prisma.labLaunch.findUnique({ where: { id } });
      return row ? toDomain(row) : null;
    },

    async findByExamAttemptId(examAttemptId: string): Promise<LabLaunch | null> {
      const row = await prisma.labLaunch.findUnique({ where: { examAttemptId } });
      return row ? toDomain(row) : null;
    },
  };
}

function toDomain(row: {
  id: string;
  examAttemptId: string;
  candidateId: string;
  participantEmail: string | null;
  trainingId: string | null;
  experienceId: string;
  environmentExternalId: string | null;
  environmentId: string | null;
  loginUrl: string;
  status: string;
  createdAt: Date;
}): LabLaunch {
  return {
    id: row.id,
    examAttemptId: row.examAttemptId,
    candidateId: row.candidateId,
    participantEmail: row.participantEmail ?? undefined,
    trainingId: row.trainingId ?? undefined,
    experienceId: row.experienceId,
    environmentExternalId: row.environmentExternalId ?? undefined,
    environmentId: row.environmentId ?? undefined,
    loginUrl: row.loginUrl,
    status: row.status as LabLaunch["status"],
    createdAt: row.createdAt,
  };
}
