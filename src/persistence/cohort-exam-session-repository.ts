import type { CohortExamSession, CohortExamSessionRepository } from "@/domain/cohort-exam-session";

export function createInMemoryCohortExamSessionRepository(): CohortExamSessionRepository & { reset(): void } {
  const byId = new Map<string, CohortExamSession>();

  return {
    async save(session: CohortExamSession): Promise<void> {
      byId.set(session.id, session);
    },
    async findById(id: string): Promise<CohortExamSession | null> {
      return byId.get(id) ?? null;
    },
    async listByExamId(examId: string): Promise<CohortExamSession[]> {
      return [...byId.values()]
        .filter((session) => session.examId === examId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    async claimDraftForPublishing(input): Promise<CohortExamSession | null> {
      const session = byId.get(input.id);
      if (
        !session ||
        session.customerId !== input.customerId ||
        session.examId !== input.examId ||
        session.status !== "draft"
      ) {
        return null;
      }
      const claimed: CohortExamSession = {
        ...session,
        status: "publishing",
        admissionClosedAt: session.admissionClosedAt ?? null,
        retiredAt: session.retiredAt ?? null,
        updatedAt: input.claimedAt,
      };
      byId.set(claimed.id, claimed);
      return claimed;
    },
    reset(): void {
      byId.clear();
    },
  };
}
