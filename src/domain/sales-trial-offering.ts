export type SalesTrialOfferingStatus =
  | "draft"
  | "provisioning"
  | "published"
  | "ending"
  | "ended"
  | "unpublished"
  | "needs_attention";

/** Customer-scoped catalog entry for one shared CloudShare Sales Trial. */
export interface SalesTrialOffering {
  readonly id: string;
  readonly customerId: string;
  readonly title: string;
  readonly description: string;
  readonly itemId: string;
  /** Server-only provider correlation; never expose through ordinary APIs. */
  readonly cloudShareSalesExperienceId: string | null;
  /** Server-only provider correlation; never expose through ordinary APIs. */
  readonly externalId: string | null;
  readonly start: string;
  readonly end: string | null;
  readonly timeZone: string;
  readonly salesProEmail: string;
  readonly salesProDisplayName: string | null;
  readonly status: SalesTrialOfferingStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly publishedAt: Date | null;
  readonly unpublishedAt: Date | null;
  readonly attentionReason: string | null;
  readonly endingCalculatedEnd?: string | null;
  readonly endingLastReconciledAt?: Date | null;
  readonly endingLeaseToken?: string | null;
  readonly endingLeaseExpiresAt?: Date | null;
}

export interface SalesTrialOfferingRepository {
  save(offering: SalesTrialOffering): Promise<void>;
  reservePublication?(
    customerId: string,
    id: string,
    update: {
      readonly externalId: string;
      readonly updatedAt: Date;
      readonly attentionReason: string;
    },
  ): Promise<boolean>;
  releasePublicationReservation?(
    customerId: string,
    id: string,
    update: {
      readonly updatedAt: Date;
      readonly attentionReason: string | null;
    },
  ): Promise<boolean>;
  markPublishNeedsAttention?(
    customerId: string,
    id: string,
    update: {
      readonly cloudShareSalesExperienceId: string | null;
      readonly externalId: string;
      readonly salesProDisplayName: string | null;
      readonly updatedAt: Date;
      readonly publishedAt: Date;
      readonly attentionReason: string;
    },
  ): Promise<boolean>;
  markEndNeedsAttention?(
    customerId: string,
    id: string,
    update: {
      readonly end: string;
      readonly updatedAt: Date;
      readonly unpublishedAt: Date;
      readonly attentionReason: string;
    },
  ): Promise<boolean>;
  findById(customerId: string, id: string): Promise<SalesTrialOffering | null>;
  listByCustomerId(customerId: string): Promise<readonly SalesTrialOffering[]>;
  listPublishedByCustomerId(customerId: string): Promise<readonly SalesTrialOffering[]>;
  listEnding?(customerId?: string): Promise<readonly SalesTrialOffering[]>;
  reserveEndingReconciliation?(customerId: string, id: string, token: string, now: Date, expiresAt: Date, unpublishedAt: Date): Promise<boolean>;
  releaseEndingReconciliation?(customerId: string, id: string, token: string): Promise<void>;
}
