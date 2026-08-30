export type SalesTrialEnrollmentStatus = "provisioning" | "active" | "needs_attention";

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
  findByOfferingAndPortalUser(
    customerId: string,
    salesTrialOfferingId: string,
    portalUserId: string,
  ): Promise<SalesTrialEnrollment | null>;
  listByOffering(
    customerId: string,
    salesTrialOfferingId: string,
  ): Promise<readonly SalesTrialEnrollment[]>;
}
