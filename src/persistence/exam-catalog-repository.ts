import type { Exam, ExamRepository } from "@/domain/exam-catalog";

export function createInMemoryExamCatalogRepository(): ExamRepository & { reset(): void } {
  const byId = new Map<string, Exam>();

  return {
    async save(exam: Exam): Promise<void> {
      byId.set(exam.id, exam);
    },
    async findById(id: string): Promise<Exam | null> {
      return byId.get(id) ?? null;
    },
    async listByCustomerId(customerId: string): Promise<Exam[]> {
      return [...byId.values()].filter((exam) => exam.customerId === customerId);
    },
    reset(): void {
      byId.clear();
    },
  };
}
