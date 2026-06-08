/**
 * Eligibility is the decision about which exams a candidate currently qualifies
 * to book (e.g. prerequisite training completed). The Genesys integration
 * provides it; the booking use case depends only on this port, so the real
 * Genesys API can replace the simulator without touching domain logic.
 */

export interface EligibleExam {
  readonly examId: string;
  readonly title: string;
}

export interface ExamEligibilityProvider {
  /** The exams this candidate currently qualifies to book. */
  listEligibleExams(candidateId: string): Promise<EligibleExam[]>;
}
