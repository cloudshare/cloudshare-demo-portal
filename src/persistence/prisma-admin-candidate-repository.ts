import type { PrismaClient } from "@prisma/client";
import type {
  AdminCandidateAttemptRecord,
  AdminCandidateAttemptStatus,
  AdminCandidateRecord,
  AdminCandidateRepository,
} from "@/domain/admin-candidates";

type CandidateUserRow = {
  readonly id: string;
  readonly customerId: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly role: string;
  readonly createdAt: Date;
};

type CandidateAttemptRow = {
  readonly id: string;
  readonly customerId: string;
  readonly candidateId: string;
  readonly examId: string;
  readonly status: string;
  readonly scheduledFor: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly exam: {
    readonly title: string;
    readonly scoreRetrievalEnabled: boolean;
  };
};

export function createPrismaAdminCandidateRepository(
  prisma: PrismaClient,
): AdminCandidateRepository {
  return {
    async listByCustomerId(
      customerId: string,
      query?: { readonly search?: string },
    ): Promise<AdminCandidateRecord[]> {
      const search = query?.search?.trim();
      const candidates = await prisma.user.findMany({
        where: {
          customerId,
          role: "candidate",
          ...(search
            ? {
                OR: [
                  { email: { contains: search } },
                  { firstName: { contains: search } },
                  { lastName: { contains: search } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          customerId: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          createdAt: true,
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { email: "asc" }],
      });

      return attachAttempts(prisma, customerId, candidates);
    },

    async findByCustomerIdAndCandidateId(
      customerId: string,
      candidateId: string,
    ): Promise<AdminCandidateRecord | null> {
      const candidate = await prisma.user.findFirst({
        where: {
          customerId,
          id: candidateId,
          role: "candidate",
        },
        select: {
          id: true,
          customerId: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          createdAt: true,
        },
      });
      if (!candidate) {
        return null;
      }

      return (await attachAttempts(prisma, customerId, [candidate]))[0] ?? null;
    },
  };
}

async function attachAttempts(
  prisma: PrismaClient,
  customerId: string,
  candidates: CandidateUserRow[],
): Promise<AdminCandidateRecord[]> {
  const candidateIds = candidates.map((candidate) => candidate.id);
  const attempts: CandidateAttemptRow[] = candidateIds.length
    ? await prisma.examAttempt.findMany({
        where: {
          customerId,
          candidateId: { in: candidateIds },
        },
        include: { exam: true },
        orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      })
    : [];
  const attemptsByCandidateId = groupBy(attempts, (attempt) => attempt.candidateId);

  return candidates.map((candidate) => ({
    id: candidate.id,
    customerId: candidate.customerId,
    email: candidate.email,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    role: "candidate",
    createdAt: candidate.createdAt,
    attempts: (attemptsByCandidateId.get(candidate.id) ?? []).map(toAttemptRecord),
  }));
}

function toAttemptRecord(row: CandidateAttemptRow): AdminCandidateAttemptRecord {
  return {
    id: row.id,
    customerId: row.customerId,
    candidateId: row.candidateId,
    examId: row.examId,
    examTitle: row.exam.title,
    status: row.status as AdminCandidateAttemptStatus,
    scheduledFor: row.scheduledFor,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    scoreRetrievalEnabled: row.exam.scoreRetrievalEnabled,
  };
}

function groupBy<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const existing = grouped.get(key);
    if (existing) {
      existing.push(item);
    } else {
      grouped.set(key, [item]);
    }
  }
  return grouped;
}
