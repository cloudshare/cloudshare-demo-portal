export type SalesTrialEnrollmentStatus =
  | "provisioning"
  | "active"
  | "needs_attention"
  | "retryable_failure";

export interface SalesTrialEnrollment {
  readonly id: string;
  readonly customerId: string;
  readonly salesTrialOfferingId: string;
  readonly portalUserId: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly cloudShareParticipantId: string | null;
  readonly cloudShareRosterEnvironmentReference: string | null;
  readonly environmentStatus: string | null;
  readonly firstJoined: string | null;
  readonly status: SalesTrialEnrollmentStatus;
  readonly attentionReason: string | null;
  readonly lastLaunchedAt: Date | null;
  readonly lastReconciledAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SalesTrialEnrollmentRepository {
  save(enrollment: SalesTrialEnrollment): Promise<void>;
  reserveForLaunch?(
    enrollment: SalesTrialEnrollment,
  ): Promise<{
    readonly enrollment: SalesTrialEnrollment;
    readonly created: boolean;
    readonly reclaimed: boolean;
  }>;
  findByOfferingAndPortalUser(
    customerId: string,
    salesTrialOfferingId: string,
    portalUserId: string,
  ): Promise<SalesTrialEnrollment | null>;
  listByOffering(
    customerId: string,
    salesTrialOfferingId: string,
  ): Promise<readonly SalesTrialEnrollment[]>;
  listByPortalUser(
    customerId: string,
    portalUserId: string,
  ): Promise<readonly SalesTrialEnrollment[]>;
}

export function hasContinuableSalesTrialEnvironment(
  enrollment: SalesTrialEnrollment | null,
): enrollment is SalesTrialEnrollment {
  if (
    !enrollment ||
    enrollment.status !== "active" ||
    enrollment.lastLaunchedAt === null ||
    enrollment.cloudShareParticipantId === null ||
    enrollment.cloudShareRosterEnvironmentReference === null ||
    enrollment.environmentStatus === null
  ) {
    return false;
  }
  const status = enrollment.environmentStatus.trim().toLowerCase();
  return status !== "deleted" && status !== "creation failed";
}
