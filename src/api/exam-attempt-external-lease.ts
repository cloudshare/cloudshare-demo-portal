import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { LabLaunchRepository } from "@/domain/lab-launch";
import { createCloudShareEnvironmentSource } from "@/integrations/cloudshare/environment";

export interface ExamAttemptExternalLeaseDeps {
  readonly launches: LabLaunchRepository;
  readonly connections?: CloudShareConnectionRepository;
  readonly cloudshare?: CloudShareClientFactory;
}

export interface ExpiredCloudShareLeaseInspection {
  readonly kind: "expired";
  readonly examAttemptId: string;
  readonly trainingId: string | null;
  readonly environmentExternalId: string | null;
  readonly environmentStatus: "archived" | "deleted";
  readonly request?: Readonly<Record<string, unknown>> | null;
  readonly response?: Readonly<Record<string, unknown>> | null;
}

export interface ActiveCloudShareLeaseInspection {
  readonly kind: "active";
  readonly examAttemptId: string;
  readonly trainingId: string | null;
  readonly environmentExternalId: string | null;
  readonly environmentStatus: string;
  readonly request?: Readonly<Record<string, unknown>> | null;
  readonly response?: Readonly<Record<string, unknown>> | null;
}

export interface UnknownCloudShareLeaseInspection {
  readonly kind: "unknown";
  readonly examAttemptId: string;
  readonly trainingId: string | null;
  readonly environmentExternalId: string | null;
}

export type CloudShareLeaseInspection =
  | ExpiredCloudShareLeaseInspection
  | ActiveCloudShareLeaseInspection
  | UnknownCloudShareLeaseInspection;

export async function inspectExamAttemptExternalLease(
  deps: ExamAttemptExternalLeaseDeps,
  input: {
    readonly examAttemptId: string;
    readonly customerId?: string | null;
    readonly environmentExternalId?: string | null;
  },
): Promise<CloudShareLeaseInspection> {
  const launch = await deps.launches.findByExamAttemptId(input.examAttemptId);
  const environmentExternalId =
    input.environmentExternalId !== undefined
      ? input.environmentExternalId
      : launch?.environmentExternalId ?? launch?.environmentId ?? null;

  if (
    !launch ||
    !environmentExternalId ||
    !input.customerId ||
    !deps.connections ||
    !deps.cloudshare
  ) {
    return {
      kind: "unknown",
      examAttemptId: input.examAttemptId,
      trainingId: launch?.trainingId ?? null,
      environmentExternalId,
    };
  }

  const connection = await deps.connections.findByCustomerId(input.customerId);
  if (!connection) {
    return {
      kind: "unknown",
      examAttemptId: input.examAttemptId,
      trainingId: launch.trainingId ?? null,
      environmentExternalId,
    };
  }

  const source = createCloudShareEnvironmentSource(
    deps.cloudshare.forConnection(connection),
  );
  let snapshot;
  try {
    snapshot = await source.getEnvironmentState(environmentExternalId);
  } catch {
    return {
      kind: "unknown",
      examAttemptId: input.examAttemptId,
      trainingId: launch.trainingId ?? null,
      environmentExternalId,
    };
  }

  if (!snapshot) {
    return {
      kind: "expired",
      examAttemptId: input.examAttemptId,
      trainingId: launch.trainingId ?? null,
      environmentExternalId,
      environmentStatus: "deleted",
    };
  }

  if (snapshot.status === "archived" || snapshot.status === "deleted") {
    return {
      kind: "expired",
      examAttemptId: input.examAttemptId,
      trainingId: launch.trainingId ?? null,
      environmentExternalId,
      environmentStatus: snapshot.status,
      request: snapshot.request ?? null,
      response: snapshot.response ?? null,
    };
  }

  return {
    kind: "active",
    examAttemptId: input.examAttemptId,
    trainingId: launch.trainingId ?? null,
    environmentExternalId,
    environmentStatus: snapshot.status,
    request: snapshot.request ?? null,
    response: snapshot.response ?? null,
  };
}
