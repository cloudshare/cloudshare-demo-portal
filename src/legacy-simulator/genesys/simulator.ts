import type { EligibleExam, ExamEligibilityProvider } from "@/domain/eligibility";

/**
 * Retired Genesys simulator retained only for the legacy `/demo` compatibility
 * flow. It decides which old demo exams a Candidate can see from
 * invented-but-believable prerequisite training records.
 */

export interface GenesysExam {
  readonly examId: string;
  readonly title: string;
  /** Training course ids completed before the old demo makes the exam available. */
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
