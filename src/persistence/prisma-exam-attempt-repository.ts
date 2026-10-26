import { transitionExamClock, type ExamClockState } from "@/domain/exam-clock";
import type { PrismaClient } from "@prisma/client";
import {
  DuplicateCohortExamAttemptError,
  SameExamAttemptAvailabilityConflictError,
  type ExamAttempt,
  type ExamAttemptRepository,
  type PendingExamAttemptRuntimeCommand,
} from "@/domain/exam-attempt";

const ADMISSION_LOCK_RETRY_LIMIT = 10;
const ADMISSION_LOCK_RETRY_DELAY_MS = 25;

export function createPrismaExamAttemptRepository(prisma: PrismaClient): ExamAttemptRepository {
  return {
    async readRuntimeCommand(customerId, examAttemptId) {
      const row = await prisma.examAttemptRuntimeCommand.findFirst({ where: { customerId, examAttemptId } });
      return row as PendingExamAttemptRuntimeCommand | null;
    },
    async claimRuntimeCommand(command, expectedStatus) {
      const changed = await prisma.$executeRaw`INSERT INTO "ExamAttemptRuntimeCommand" ("examAttemptId", "customerId", "commandId", "action", "environmentId")
        SELECT "id", "customerId", ${command.commandId}, ${command.action}, ${command.environmentId}
        FROM "ExamAttempt" WHERE "id" = ${command.examAttemptId} AND "customerId" = ${command.customerId} AND "status" = ${expectedStatus}
        ON CONFLICT DO NOTHING`;
      return changed === 1;
    },
    async finishRuntimeCommandDispatch(command) {
      const changed = await prisma.examAttemptRuntimeCommand.updateMany({ where: { ...command, phase: "dispatching" }, data: { phase: "observing" } });
      return changed.count === 1;
    },
    async settleRuntimeCommand(command, at) {
      return prisma.$transaction(async tx => {
        const marker = await tx.examAttemptRuntimeCommand.findFirst({ where: { ...command, phase: "observing" } });
        if (!marker) return false;
        const changed = await tx.examAttempt.updateMany({ where: { id: command.examAttemptId, customerId: command.customerId, status: { in: ["in_progress", "suspended"] } }, data: { status: command.action === "suspend" ? "suspended" : "in_progress" } });
        if (changed.count !== 1) return false;
        const prior = await tx.examClock.findUnique({ where: { examAttemptId: command.examAttemptId } });
        const next = transitionExamClock(prior as ExamClockState | null, command.examAttemptId, command.action, at);
        await tx.examClock.upsert({ where: { examAttemptId: command.examAttemptId }, create: next, update: next });
        await tx.examAttemptRuntimeCommand.deleteMany({ where: { ...command, phase: "observing" } });
        return true;
      });
    },
    async releaseRuntimeCommand(command) {
      await prisma.examAttemptRuntimeCommand.deleteMany({ where: { ...command, phase: "dispatching" } });
    },
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
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
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
