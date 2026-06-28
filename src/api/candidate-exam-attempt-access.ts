import { getPortalSession, type PortalSessionDeps } from "@/auth/portal-session";
import type { PortalSession } from "@/auth/portal-stores";
import type { ExamAttempt, ExamAttemptRepository } from "@/domain/exam-attempt";
import type { LabLaunch, LabLaunchRepository } from "@/domain/lab-launch";

export interface CandidateExamAttemptAccessDeps {
  readonly getPortalSession: (sessionId: string | undefined) => Promise<PortalSession | null>;
  readonly examAttempts: Pick<ExamAttemptRepository, "findById">;
  readonly labLaunches: Pick<LabLaunchRepository, "findByExamAttemptId">;
}

export interface CandidateExamAttemptAccessServices extends PortalSessionDeps {
  readonly examAttempts: CandidateExamAttemptAccessDeps["examAttempts"];
  readonly labLaunches: CandidateExamAttemptAccessDeps["labLaunches"];
}

export type CandidateExamAttemptAccessResult =
  | {
      readonly ok: true;
      readonly session: {
        readonly userId: string;
        readonly customerId: string;
      };
      readonly attempt: ExamAttempt;
      readonly launch: LabLaunch | null;
    }
  | {
      readonly ok: false;
      readonly response: {
        readonly status: number;
        readonly body: { error: string };
      };
    };

export function buildCandidateExamAttemptAccessDeps(
  services: CandidateExamAttemptAccessServices,
): CandidateExamAttemptAccessDeps {
  return {
    getPortalSession: (sessionId) => getPortalSession(services, sessionId),
    examAttempts: services.examAttempts,
    labLaunches: services.labLaunches,
  };
}

export async function authorizeCandidateExamAttemptAccess(
  deps: CandidateExamAttemptAccessDeps,
  input: {
    readonly sessionId: string | undefined;
    readonly examAttemptId: string;
    readonly requireLaunch?: boolean;
    readonly requireInProgress?: boolean;
  },
): Promise<CandidateExamAttemptAccessResult> {
  const session = await deps.getPortalSession(input.sessionId);
  if (!session || session.role !== "candidate") {
    return {
      ok: false,
      response: {
        status: 401,
        body: { error: "unauthorized" },
      },
    };
  }

  const attempt = await deps.examAttempts.findById(input.examAttemptId);
  if (
    !attempt ||
    attempt.candidateId !== session.userId ||
    (attempt.customerId && attempt.customerId !== session.customerId)
  ) {
    return {
      ok: false,
      response: {
        status: 403,
        body: { error: "forbidden" },
      },
    };
  }

  const launch = await deps.labLaunches.findByExamAttemptId(input.examAttemptId);
  if (input.requireLaunch && !launch) {
    return {
      ok: false,
      response: {
        status: 409,
        body: { error: "exam attempt has no active lab launch" },
      },
    };
  }

  if (input.requireInProgress && attempt.status !== "in_progress") {
    return {
      ok: false,
      response: {
        status: 409,
        body: { error: "exam attempt is not in progress" },
      },
    };
  }

  return {
    ok: true,
    session: {
      userId: session.userId,
      customerId: session.customerId,
    },
    attempt,
    launch: launch ?? null,
  };
}
