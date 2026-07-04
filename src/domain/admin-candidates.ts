import type { ActiveExamAttemptStatus } from "./exam-attempt";

export type AdminCandidateAttemptStatus = ActiveExamAttemptStatus;

export interface AdminCandidateAttemptRecord {
  readonly id: string;
  readonly customerId: string;
  readonly candidateId: string;
  readonly examId: string;
  readonly examTitle: string;
  readonly status: AdminCandidateAttemptStatus;
  readonly scheduledFor: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly scoreRetrievalEnabled: boolean;
}

export interface AdminCandidateRecord {
  readonly id: string;
  readonly customerId: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly role: "candidate";
  readonly createdAt: Date;
  readonly attempts: readonly AdminCandidateAttemptRecord[];
}

export interface AdminCandidateRepository {
  listByCustomerId(
    customerId: string,
    query?: { readonly search?: string },
  ): Promise<AdminCandidateRecord[]>;
  findByCustomerIdAndCandidateId(
    customerId: string,
    candidateId: string,
  ): Promise<AdminCandidateRecord | null>;
}

export interface AdminCandidateAttemptSummary {
  readonly scheduled: number;
  readonly ready: number;
  readonly inProgress: number;
  readonly suspended: number;
  readonly completed: number;
  readonly expired: number;
  readonly total: number;
}

export interface AdminCandidateScoreEvidence {
  readonly scoreAvailable: boolean;
  readonly percentComplete?: number;
  readonly stepsCompleted?: number;
  readonly stepsTotal?: number;
  readonly passedRate?: number;
  readonly failedRate?: number;
  readonly retrievedAt: string;
}

export interface AdminCandidateAttemptView {
  readonly id: string;
  readonly examId: string;
  readonly examTitle: string;
  readonly status: AdminCandidateAttemptStatus;
  readonly scheduledFor: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly scoreRetrievalEnabled: boolean;
  readonly score: AdminCandidateScoreEvidence | null;
}

export interface AdminCandidateRosterItem {
  readonly id: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly name: string;
  readonly createdAt: string;
  readonly attemptSummary: AdminCandidateAttemptSummary;
  readonly latestAttempt: AdminCandidateAttemptView | null;
  readonly latestScore: AdminCandidateScoreEvidence | null;
}

export interface AdminCandidateDetailView extends AdminCandidateRosterItem {
  readonly attempts: readonly AdminCandidateAttemptView[];
}

export function formatAdminCandidateName(
  candidate: Pick<AdminCandidateRecord, "email" | "firstName" | "lastName">,
): string {
  const firstName = candidate.firstName?.trim() ?? "";
  const lastName = candidate.lastName?.trim() ?? "";
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || candidate.email;
}

export function buildAdminCandidateAttemptSummary(
  attempts: readonly Pick<AdminCandidateAttemptRecord, "status">[],
): AdminCandidateAttemptSummary {
  const summary = {
    scheduled: 0,
    ready: 0,
    inProgress: 0,
    suspended: 0,
    completed: 0,
    expired: 0,
    total: attempts.length,
  };

  for (const attempt of attempts) {
    switch (attempt.status) {
      case "scheduled":
        summary.scheduled += 1;
        break;
      case "ready":
        summary.ready += 1;
        break;
      case "in_progress":
        summary.inProgress += 1;
        break;
      case "suspended":
        summary.suspended += 1;
        break;
      case "completed":
        summary.completed += 1;
        break;
      case "expired":
        summary.expired += 1;
        break;
    }
  }

  return summary;
}
