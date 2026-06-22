export interface AdminExamAttemptDiagnosticContextRecord {
  readonly attemptId: string;
  readonly customerId: string;
  readonly attemptStatus: string;
  readonly scheduledFor: Date | null;
  readonly createdAt: Date;
  readonly candidateId: string;
  readonly candidateEmail: string;
  readonly candidateFirstName: string | null;
  readonly candidateLastName: string | null;
  readonly examId: string;
  readonly examTitle: string;
  readonly examStatus: string;
  readonly scoreRetrievalEnabled: boolean;
  readonly trainingId: string | null;
  readonly experienceId: string | null;
  readonly environmentExternalId: string | null;
  readonly environmentId: string | null;
  readonly participantId: string | null;
  readonly participantEmail: string | null;
}

export interface AdminExamAttemptDiagnosticContextRepository {
  findByExamAttemptId(
    customerId: string,
    examAttemptId: string,
  ): Promise<AdminExamAttemptDiagnosticContextRecord | null>;
}
