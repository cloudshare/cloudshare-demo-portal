import type { EligibleExam, ExamEligibilityProvider } from "@/domain/eligibility";

/**
 * Genesys simulator. Stands in for the Genesys certification platform, deciding
 * which exams a candidate is eligible to book from invented-but-believable
 * criteria: a candidate is eligible for an exam once they have completed all of
 * its prerequisite training courses.
 *
 * Implements the {@link ExamEligibilityProvider} port, so the real Genesys API
 * can replace it without touching the booking use case.
 */

export interface GenesysExam {
  readonly examId: string;
  readonly title: string;
  /** Training course ids that must be completed before the exam is bookable. */
  readonly prerequisites: string[];
}

export interface CandidateTraining {
  readonly candidateId: string;
  readonly completedCourses: string[];
}

export interface GenesysSimulatorData {
  readonly exams: GenesysExam[];
  readonly training: CandidateTraining[];
}

export function createGenesysSimulator(
  data: GenesysSimulatorData,
): ExamEligibilityProvider {
  const completedByCandidate = new Map<string, Set<string>>(
    data.training.map((t) => [t.candidateId, new Set(t.completedCourses)]),
  );

  return {
    async listEligibleExams(candidateId: string): Promise<EligibleExam[]> {
      const completed = completedByCandidate.get(candidateId) ?? new Set<string>();
      return data.exams
        .filter((exam) => exam.prerequisites.every((p) => completed.has(p)))
        .map((exam) => ({ examId: exam.examId, title: exam.title }));
    },
  };
}
