import { Prisma, type PrismaClient } from "@prisma/client";
import {
  DuplicateCohortExamAttemptError,
  SameExamAttemptAvailabilityConflictError,
  type ExamAttempt,
  type ExamAttemptRepository,
} from "@/domain/exam-attempt";

const ADMISSION_LOCK_RETRY_LIMIT = 10;
const ADMISSION_LOCK_RETRY_DELAY_MS = 25;

export function createPrismaExamAttemptRepository(prisma: PrismaClient): ExamAttemptRepository {
  return {
    async save(attempt: ExamAttempt): Promise<void> {
      await saveAttempt(prisma, attempt);
    },

    async saveWithSameExamAvailabilityGuard(
      attempt: ExamAttempt,
      options: { readonly availabilityWindowMinutes: number },
    ): Promise<void> {
      for (let attemptNumber = 0; attemptNumber < ADMISSION_LOCK_RETRY_LIMIT; attemptNumber += 1) {
        const lockId = `${attempt.candidateId}:${attempt.examId}:${Date.now()}:${attemptNumber}`;
        try {
          await prisma.examAttemptAdmissionLock.create({
            data: {
              id: lockId,
              candidateId: attempt.candidateId,
              examId: attempt.examId,
            },
          });
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            await delay(ADMISSION_LOCK_RETRY_DELAY_MS);
            continue;
          }
          throw error;
        }

        try {
          const overlap = await findSameExamAvailabilityOverlap(prisma, {
            attempt,
            availabilityWindowMinutes: options.availabilityWindowMinutes,
          });
          if (overlap) {
            throw new SameExamAttemptAvailabilityConflictError(
              attempt.candidateId,
              attempt.examId,
              overlap.conflictingAttemptId,
              overlap.nextAvailableAt,
            );
          }
          await saveAttempt(prisma, attempt);
          return;
        } finally {
          await prisma.examAttemptAdmissionLock.deleteMany({ where: { id: lockId } });
        }
      }

      throw new SameExamAttemptAvailabilityConflictError(
        attempt.candidateId,
        attempt.examId,
        "candidate-exam-admission-lock",
        attempt.scheduledFor ?? new Date(),
      );
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

async function saveAttempt(prisma: PrismaClient, attempt: ExamAttempt): Promise<void> {
  try {
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
  } catch (error) {
    if (attempt.cohortSessionId && isUniqueConstraintError(error)) {
      throw new DuplicateCohortExamAttemptError(
        attempt.candidateId,
        attempt.cohortSessionId,
      );
    }
    throw error;
  }
}

async function findSameExamAvailabilityOverlap(
  prisma: PrismaClient,
  input: {
    readonly attempt: ExamAttempt;
    readonly availabilityWindowMinutes: number;
  },
): Promise<{ readonly conflictingAttemptId: string; readonly nextAvailableAt: Date } | null> {
  if (!input.attempt.scheduledFor) {
    return null;
  }

  const requestedAtMs = input.attempt.scheduledFor.getTime();
  const windowMs = input.availabilityWindowMinutes * 60_000;
  const requestedEndMs = requestedAtMs + windowMs;
  const earliestOverlappingStart = new Date(requestedAtMs - windowMs);
  const latestOverlappingStart = new Date(requestedEndMs);

  const rows = await prisma.examAttempt.findMany({
    where: {
      candidateId: input.attempt.candidateId,
      examId: input.attempt.examId,
      id: { not: input.attempt.id },
      status: { notIn: ["completed", "expired"] },
      scheduledFor: {
        not: null,
        gt: earliestOverlappingStart,
        lt: latestOverlappingStart,
      },
    },
    orderBy: [{ scheduledFor: "asc" }, { id: "asc" }],
  });

  for (const row of rows) {
    if (!row.scheduledFor) {
      continue;
    }
    const windowStartMs = row.scheduledFor.getTime();
    const windowEndMs = windowStartMs + windowMs;
    if (requestedAtMs < windowEndMs && requestedEndMs > windowStartMs) {
      return {
        conflictingAttemptId: row.id,
        nextAvailableAt: new Date(windowEndMs),
      };
    }
  }

  return null;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
