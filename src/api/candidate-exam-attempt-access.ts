import type { Services } from "@/composition";
import type { ExamAttempt } from "@/domain/exam-attempt";
import type { LabLaunch } from "@/domain/lab-launch";
import { getPortalSession } from "@/auth/portal-session";

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

export async function authorizeCandidateExamAttemptAccess(
  services: Services,
  input: {
    readonly sessionId: string | undefined;
    readonly examAttemptId: string;
    readonly requireLaunch?: boolean;
    readonly requireInProgress?: boolean;
  },
): Promise<CandidateExamAttemptAccessResult> {
  const session = await getPortalSession(services, input.sessionId);
  if (!session || session.role !== "candidate") {
    return {
      ok: false,
      response: {
        status: 401,
        body: { error: "unauthorized" },
      },
    };
  }

  const attempt = await services.examAttempts.findById(input.examAttemptId);
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

  const launch = await services.labLaunches.findByExamAttemptId(input.examAttemptId);
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
