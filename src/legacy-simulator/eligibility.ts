/**
 * Retired simulator eligibility is the decision about which old demo exams a
 * Candidate qualifies to book in the legacy `/demo` compatibility flow.
 */

export interface EligibleExam {
  readonly examId: string;
  readonly title: string;
}

export interface ExamEligibilityProvider {
  /** The exams this Candidate qualifies to book in the legacy simulator flow. */
  listEligibleExams(candidateId: string): Promise<EligibleExam[]>;
}
