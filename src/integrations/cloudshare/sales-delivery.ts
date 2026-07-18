import { z } from "zod";
import type { SalesExperienceType } from "@/domain/sales-experience-type";
import type { CloudShareClient, CloudShareDetailedResult, CloudShareRequestDiagnostics, CloudShareResponseDiagnostics } from "./client";
import { CloudShareResponseError } from "./errors";

/** Already-sanitized data returned by the client boundary. Keep the complete
 * exchange because Sales support needs headers and transport facts as well as
 * the Sales response body. */
export interface SalesDeliveryRequestEvidence extends CloudShareRequestDiagnostics {}
export interface SalesDeliveryResponseEvidence extends CloudShareResponseDiagnostics {}
export interface SalesDeliveryEvidence { readonly request: SalesDeliveryRequestEvidence; readonly response: SalesDeliveryResponseEvidence; }
export interface CreateSalesDemoSessionInput {
  readonly name: string;
  readonly type: SalesExperienceType;
  readonly projectId: string;
  readonly blueprintIds: readonly string[];
  readonly regionIds: readonly string[];
  readonly policyId: string;
  readonly opportunity: string;
  readonly externalId: string;
  /** Required by CloudShare even when registered-only admission and native
   * invitations make it unreachable by portal users. Generated per session
   * and retained only in redacted server-side diagnostic evidence. */
  readonly passphrase: string;
  readonly start: string;
  readonly end: string;
  readonly timeZone: string;
  readonly mainSalesProEmail: string;
  readonly registrationType: "registeredParticipantsOnly";
  /** Enables future explicit native invitations for Sales Participants and Sales Pros;
   * creating the Experience itself never sends an email. */
  readonly sendInvitations: "salesProsAndParticipants";
}
export interface SalesDelivery {
  createSession(input: CreateSalesDemoSessionInput): Promise<{ readonly salesExperienceId: string } & SalesDeliveryEvidence>;
  /** Documented v4 read used only for reconciliation and invitation capability;
   * the provider ID remains server-side. */
  readSession(salesExperienceId: string): Promise<{ readonly id: string; readonly status?: string; readonly sendInvitations?: "salesProsOnly" | "salesParticipantsOnly" | "participantsOnly" | "dontSend" | "salesProsAndParticipants" } & SalesDeliveryEvidence>;
  /** PUT always starts from a documented full GET representation. Certalis
   * changes only the provider-visible name: schedule edits need their own
   * lifecycle policy before they can be exposed. */
  updateSession?(salesExperienceId: string, changes: { readonly name: string }): Promise<{ readonly id: string } & SalesDeliveryEvidence>;
  /** Ensures the documented Sales user-property definitions used for durable
   * Certalis-to-CloudShare participant correlation. */
  ensureParticipantCorrelationProperties(salesExperienceId: string): Promise<{
    readonly requiredKeys: readonly SalesParticipantCorrelationPropertyKey[];
    readonly availableKeys: readonly string[];
    readonly requests: readonly SalesDeliveryRequestEvidence[];
    readonly responses: readonly SalesDeliveryResponseEvidence[];
  } & SalesDeliveryEvidence>;
  /** A successful add acknowledgement is deliberately not used for identity
   * correlation. CloudShare has returned partial and empty 201 bodies here;
   * callers must reconcile through the roster read after this mutation. */
  registerParticipants(salesExperienceId: string, participants: readonly SalesParticipantInput[]): Promise<SalesDeliveryEvidence>;
  /** Controlled migration of a Contact explicitly selected by a Sales Admin
   * from the pre-correlation roster. */
  updateParticipantCorrelation(salesExperienceId: string, participantId: string, input: Pick<SalesParticipantInput, "firstName" | "lastName" | "customProperties">): Promise<SalesDeliveryEvidence>;
  listParticipants(salesExperienceId: string): Promise<{ readonly participants: readonly SalesParticipant[] } & SalesDeliveryEvidence>;
  inviteParticipants(salesExperienceId: string, participantIds: readonly string[]): Promise<SalesDeliveryEvidence>;
}

export const SALES_PARTICIPANT_CORRELATION_PROPERTY_KEYS = [
  "certalisSalesParticipantId",
  "certalisOpportunityContactId",
] as const;
export type SalesParticipantCorrelationPropertyKey = (typeof SALES_PARTICIPANT_CORRELATION_PROPERTY_KEYS)[number];
export interface SalesParticipantInput { readonly firstName: string; readonly lastName: string; readonly email: string; readonly customProperties?: readonly { readonly name: string; readonly value: string }[]; }
/** Browser-safe monitoring read model. Invite URLs are not part of this documented response. */
export type SalesParticipant = Omit<SalesParticipantInput, "customProperties"> & {
  readonly id: string; readonly invitationStatus: "sent" | "notSent"; readonly invitedBy: string | null;
  readonly participationStatus: "pending" | "inProgress" | "concluded"; readonly firstJoined: string | null;
  /** Server-only CloudShare correlation; never include it in portal projections. */
  readonly environmentId: string | null;
  /** Null before CloudShare has assigned a runnable environment. */
  readonly envStatus: string | null;
  /** Server-only Certalis correlation values returned by the documented roster. */
  readonly customProperties: Readonly<Record<string, string>>;
};

const salesExperienceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  status: z.string().optional(),
  type: z.enum(["demo", "poc", "pov", "trial"]).optional(),
  projectId: z.string().min(1).optional(),
  teamId: z.string().optional(),
  blueprintIds: z.array(z.string()).min(1).optional(),
  allowParticipantsSwitchSteps: z.boolean().nullable().optional(),
  cloudshareRegionIds: z.array(z.string()).min(1).optional(),
  awsCloudRegion: z.string().nullable().optional(),
  azureCloudRegion: z.string().nullable().optional(),
  googleCloudProviderRegion: z.string().nullable().optional(),
  googleCloudProviderZone: z.string().nullable().optional(),
  policyId: z.string().min(1).optional(),
  opportunity: z.string().min(1).optional(),
  mainSalesPro: z.object({ email: z.string().email(), teamId: z.string().nullable().optional() }).passthrough().optional(),
  additionalSalesPros: z.array(z.unknown()).nullable().optional(),
  registrationType: z.enum(["registeredParticipantsOnly", "anyParticipants"]).optional(),
  passphrase: z.string().optional(),
  description: z.string().nullable().optional(),
  labels: z.array(z.unknown()).nullable().optional(),
  externalId: z.string().nullable().optional(),
  allowMultipleEnvironmentActivations: z.boolean().optional(),
  sendInvitations: z.enum(["salesProsOnly", "salesParticipantsOnly", "participantsOnly", "dontSend", "salesProsAndParticipants"]).optional(),
  emailDomainBlocklist: z.array(z.unknown()).nullable().optional(),
  blockFreeEmailDomains: z.boolean().optional(),
  customFields: z.array(z.unknown()).nullable().optional(),
  useCustomInvitationEmail: z.boolean().optional(),
  preConfigureParticipantEnvironments: z.boolean().nullable().optional(),
  sharedEnvBlueprintId: z.string().nullable().optional(),
  sharedEnvPolicyId: z.string().nullable().optional(),
  isSharedLabViewAccessEnabled: z.boolean().nullable().optional(),
  allowAudioVideo: z.boolean().optional(),
  start: z.string().optional(),
  end: z.string().nullable().optional(),
  timeZone: z.string().optional(),
}).passthrough();
const salesEnvironmentStatusSchema = z.enum([
  "FutureAllocationScheduled", "AllocationScheduledNoRun", "Ready", "Suspended", "Archived", "Deleted",
  "Publishing", "Preparing", "CreationFailed", "InGrace", "Stopping", "EditingNetworks",
]);
const salesParticipantSchema = z.object({
  id: z.string().min(1),
  firstName: z.string().min(2).max(64),
  lastName: z.string().min(2).max(64),
  email: z.string().email().max(100),
  invitationStatus: z.enum(["sent", "notSent"]),
  invitedBy: z.string().email().nullable(),
  participationStatus: z.enum(["pending", "inProgress", "concluded"]),
  firstJoined: z.string().datetime({ offset: true }).nullable(),
  // The published schema lists environment states, but the live Sales roster
  // returns null until a registered participant has an environment.
  envStatus: salesEnvironmentStatusSchema.nullable(),
  envId: z.string().min(1).nullable(),
  customProperties: z.preprocess((value) => value ?? [], z.array(z.object({ name: z.string(), value: z.string().max(1024) }))),
});
const salesUserPropertyDefinitionSchema = z.object({ id: z.string().min(1), name: z.string().min(1), order: z.number().int().optional() });
const salesUserPropertyDefinitionsSchema = z.array(salesUserPropertyDefinitionSchema);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
/** Normalize only the small participant roster contract Certalis needs for
 * browser projections. The shared client retains the full, sanitised provider
 * exchange separately as authorised Support evidence. */
export function normalizeSalesParticipantPage(payload: unknown): unknown {
  const envelope = record(payload);
  if (!envelope) return payload;
  const camelParticipants = Array.isArray(envelope.participants);
  const camelItems = Array.isArray(envelope.items) && Object.hasOwn(envelope, "count");
  const recognizedEnvelopeCount = [camelParticipants, camelItems].filter(Boolean).length;
  if (recognizedEnvelopeCount !== 1) return payload;
  const rows = camelParticipants ? envelope.participants : envelope.items;
  const hasCount = Object.hasOwn(envelope, "count");
  const rawCount = envelope.count;
  const count = !hasCount ? undefined : typeof rawCount === "number" && Number.isInteger(rawCount) && rawCount >= 0 ? rawCount : null;
  if (count === null) return payload;
  return { ...(count === undefined ? {} : { count }), participants: rows };
}
const participantsEnvelopeSchema = z.preprocess(normalizeSalesParticipantPage, z.object({ count: z.number().int().nonnegative().optional(), participants: z.array(salesParticipantSchema) }));
const PARTICIPANT_PAGE_LIMIT = 100;

const mutableSalesExperienceFields = ["name", "type", "projectId", "teamId", "blueprintIds", "allowParticipantsSwitchSteps", "cloudshareRegionIds", "awsCloudRegion", "azureCloudRegion", "googleCloudProviderRegion", "googleCloudProviderZone", "policyId", "opportunity", "mainSalesPro", "additionalSalesPros", "start", "end", "timeZone", "registrationType", "passphrase", "description", "labels", "externalId", "allowMultipleEnvironmentActivations", "sendInvitations", "emailDomainBlocklist", "blockFreeEmailDomains", "customFields", "useCustomInvitationEmail", "preConfigureParticipantEnvironments", "sharedEnvBlueprintId", "sharedEnvPolicyId", "isSharedLabViewAccessEnabled", "allowAudioVideo"] as const;

/** The deep CloudShare Sales Delivery module. Callers never learn v4 paths,
 * wire keys, or response parsing; they only validate an owner and create a
 * time-bounded registered-only delivery. */
export function createCloudShareSalesDelivery(client: CloudShareClient): SalesDelivery {
  async function detailed<T>(spec: { method: "GET" | "POST" | "PUT"; path: string; query?: Record<string, string>; body?: unknown; allowEmptyResponse?: boolean; schema: z.ZodType<T, z.ZodTypeDef, unknown> }): Promise<{ data: T; evidence: SalesDeliveryEvidence }> {
    const result = client.requestV4Detailed
      ? await client.requestV4Detailed(spec)
      : await client.requestV4(spec).then((data) => ({ data, request: { method: spec.method, path: spec.path, ...(spec.body === undefined ? {} : { body: spec.body }) }, response: { status: 200, body: data } } as CloudShareDetailedResult<T>));
    return { data: result.data, evidence: { request: result.request, response: result.response } };
  }
  return {
    async createSession(input) {
      const body = { name: input.name, type: input.type, projectId: input.projectId, blueprintIds: input.blueprintIds, cloudshareRegionIds: input.regionIds, policyId: input.policyId, opportunity: input.opportunity, externalId: input.externalId, passphrase: input.passphrase, start: input.start, end: input.end, timeZone: input.timeZone, mainSalesPro: { email: input.mainSalesProEmail }, registrationType: input.registrationType, sendInvitations: input.sendInvitations };
      const { data, evidence } = await detailed({ method: "POST", path: "/sales", body, schema: salesExperienceSchema });
      return { salesExperienceId: data.id, ...evidence };
    },
    async readSession(salesExperienceId) {
      const { data, evidence } = await detailed({ method: "GET", path: `/sales/${encodeURIComponent(salesExperienceId)}`, schema: salesExperienceSchema });
      return { id: data.id, ...(typeof data.status === "string" ? { status: data.status } : {}), ...(data.sendInvitations ? { sendInvitations: data.sendInvitations } : {}), ...evidence };
    },
    async updateSession(salesExperienceId, changes) {
      const { data: current } = await detailed({ method: "GET", path: `/sales/${encodeURIComponent(salesExperienceId)}`, schema: salesExperienceSchema });
      if (!hasEveryMutableSalesExperienceField(current)) throw new Error("CloudShare did not return the complete documented Sales Experience required for a safe update.");
      // Sales_Experience declares many defaults. Copy every documented mutable
      // value that CloudShare returned, rather than permitting a full PUT to
      // silently reset settings outside Certalis' edit scope, including the
      // explicit-native-invite capability chosen at creation.
      const body = {
        name: changes.name,
        type: current.type,
        projectId: current.projectId,
        teamId: current.teamId,
        blueprintIds: current.blueprintIds,
        allowParticipantsSwitchSteps: current.allowParticipantsSwitchSteps,
        cloudshareRegionIds: current.cloudshareRegionIds,
        awsCloudRegion: current.awsCloudRegion,
        azureCloudRegion: current.azureCloudRegion,
        googleCloudProviderRegion: current.googleCloudProviderRegion,
        googleCloudProviderZone: current.googleCloudProviderZone,
        policyId: current.policyId,
        opportunity: current.opportunity,
        mainSalesPro: current.mainSalesPro,
        additionalSalesPros: current.additionalSalesPros,
        registrationType: current.registrationType,
        passphrase: current.passphrase,
        description: current.description,
        labels: current.labels,
        externalId: current.externalId,
        allowMultipleEnvironmentActivations: current.allowMultipleEnvironmentActivations,
        sendInvitations: current.sendInvitations,
        emailDomainBlocklist: current.emailDomainBlocklist,
        blockFreeEmailDomains: current.blockFreeEmailDomains,
        customFields: current.customFields,
        useCustomInvitationEmail: current.useCustomInvitationEmail,
        preConfigureParticipantEnvironments: current.preConfigureParticipantEnvironments,
        sharedEnvBlueprintId: current.sharedEnvBlueprintId,
        sharedEnvPolicyId: current.sharedEnvPolicyId,
        isSharedLabViewAccessEnabled: current.isSharedLabViewAccessEnabled,
        allowAudioVideo: current.allowAudioVideo,
        start: current.start,
        end: current.end,
        timeZone: current.timeZone,
      };
      const { data, evidence } = await detailed({ method: "PUT", path: `/sales/${encodeURIComponent(salesExperienceId)}`, body, schema: salesExperienceSchema });
      return { id: data.id, ...evidence };
    },
    async ensureParticipantCorrelationProperties(salesExperienceId) {
      const path = `/sales/${encodeURIComponent(salesExperienceId)}/users/properties`;
      const existing = await detailed({ method: "GET", path, schema: salesUserPropertyDefinitionsSchema });
      const existingKeys = existing.data.map((definition) => definition.name);
      const missingKeys = SALES_PARTICIPANT_CORRELATION_PROPERTY_KEYS.filter((key) => !existingKeys.includes(key));
      if (missingKeys.length === 0) return { requiredKeys: SALES_PARTICIPANT_CORRELATION_PROPERTY_KEYS, availableKeys: existingKeys, requests: [existing.evidence.request], responses: [existing.evidence.response], ...existing.evidence };
      let created: Awaited<ReturnType<typeof detailed<z.output<typeof salesUserPropertyDefinitionsSchema>>>>;
      try {
        created = await detailed({ method: "POST", path, body: missingKeys.map((name) => ({ name })), schema: salesUserPropertyDefinitionsSchema });
      } catch (error) {
        if (error instanceof Error && "context" in error) (error as Error & { context?: Record<string, unknown> }).context = { ...(error as Error & { context?: Record<string, unknown> }).context, priorHttpExchanges: [{ request: existing.evidence.request, response: existing.evidence.response }] };
        throw error;
      }
      const availableKeys = [...existingKeys, ...created.data.map((definition) => definition.name)];
      const stillMissingKeys = SALES_PARTICIPANT_CORRELATION_PROPERTY_KEYS.filter((key) => !availableKeys.includes(key));
      if (stillMissingKeys.length > 0) {
        throw new CloudShareResponseError("CloudShare Sales user-property provisioning did not return all required correlation keys.", {
          method: created.evidence.request.method, path: created.evidence.request.path,
          ...(created.evidence.request.query ? { requestQuery: created.evidence.request.query } : {}),
          ...(created.evidence.request.headers ? { requestHeaders: created.evidence.request.headers } : {}),
          ...(created.evidence.request.body !== undefined ? { requestBody: created.evidence.request.body } : {}),
          status: created.evidence.response.status, responseStatus: created.evidence.response.status,
          ...(created.evidence.response.headers ? { responseHeaders: created.evidence.response.headers } : {}),
          responseBody: created.evidence.response.body, priorHttpExchanges: [{ request: existing.evidence.request, response: existing.evidence.response }], failureMode: "sales_participant_correlation_properties_missing",
        });
      }
      return { requiredKeys: SALES_PARTICIPANT_CORRELATION_PROPERTY_KEYS, availableKeys, requests: [existing.evidence.request, created.evidence.request], responses: [existing.evidence.response, created.evidence.response], ...created.evidence };
    },
    async registerParticipants(salesExperienceId, participants) {
      // A 201 means CloudShare accepted the registration even when the body is
      // empty, partial, or shaped differently from the documented array.
      // The following GET roster, not this acknowledgement, is authoritative.
      const { evidence } = await detailed({ method: "POST", path: `/sales/${encodeURIComponent(salesExperienceId)}/participants`, body: participants, allowEmptyResponse: true, schema: z.unknown() });
      return participantEvidence(evidence);
    },
    async updateParticipantCorrelation(salesExperienceId, participantId, input) {
      // The documented PUT acknowledgement can omit roster monitoring fields.
      // The handler always follows this mutation with an authoritative GET.
      const { evidence } = await detailed({ method: "PUT", path: `/sales/${encodeURIComponent(salesExperienceId)}/participants/${encodeURIComponent(participantId)}`, body: input, schema: z.unknown() });
      return participantEvidence(evidence);
    },
    async listParticipants(salesExperienceId) {
      const path = `/sales/${encodeURIComponent(salesExperienceId)}/participants`;
      const first = await detailed<z.output<typeof participantsEnvelopeSchema>>({ method: "GET", path, query: { offset: "0", limit: String(PARTICIPANT_PAGE_LIMIT) }, schema: participantsEnvelopeSchema });
      const firstPage = participantPage(first.data);
      if (firstPage.count === undefined) {
        return { participants: firstPage.participants.map(mapSalesParticipant), ...participantEvidence(first.evidence) };
      }
      const expectedCount = firstPage.count;
      const rows = [...firstPage.participants];
      const offsets = [0];
      if (rows.length > expectedCount) throwParticipantPageFailure(first.evidence, expectedCount, rows.length, offsets, "participant_page_count_contradiction");
      if (hasDuplicateParticipantIds(rows)) throwParticipantPageFailure(first.evidence, expectedCount, rows.length, offsets, "participant_page_duplicate_id");
      const participantIds = new Set(rows.map((participant) => participant.id));
      let evidence = first.evidence;
      while (rows.length < expectedCount) {
        const offset = rows.length;
        const page = await detailed<z.output<typeof participantsEnvelopeSchema>>({ method: "GET", path, query: { offset: String(offset), limit: String(PARTICIPANT_PAGE_LIMIT) }, schema: participantsEnvelopeSchema });
        const normalizedPage = participantPage(page.data);
        offsets.push(offset);
        const returnedCount = rows.length + normalizedPage.participants.length;
        if (hasDuplicateParticipantIds(normalizedPage.participants) || normalizedPage.participants.some((participant) => participantIds.has(participant.id))) throwParticipantPageFailure(page.evidence, expectedCount, returnedCount, offsets, "participant_page_duplicate_id");
        if (normalizedPage.count !== expectedCount || normalizedPage.participants.length === 0 || returnedCount > expectedCount) throwParticipantPageFailure(page.evidence, expectedCount, returnedCount, offsets, "participant_page_count_contradiction");
        normalizedPage.participants.forEach((participant) => participantIds.add(participant.id));
        rows.push(...normalizedPage.participants);
        evidence = page.evidence;
      }
      return { participants: rows.map(mapSalesParticipant), ...participantEvidence(evidence) };
    },
    async inviteParticipants(salesExperienceId, participantIds) {
      const { evidence } = await detailed({ method: "POST", path: `/sales/${encodeURIComponent(salesExperienceId)}/participants/invite`, body: participantIds, allowEmptyResponse: true, schema: z.void() });
      return participantEvidence(evidence);
    },
  };
}

function mapSalesParticipant(participant: z.output<typeof salesParticipantSchema>): SalesParticipant {
  return {
    id: participant.id,
    firstName: participant.firstName,
    lastName: participant.lastName,
    email: participant.email,
    customProperties: Object.fromEntries(participant.customProperties.map((property) => [property.name, property.value])),
    invitationStatus: participant.invitationStatus,
    invitedBy: participant.invitedBy,
    participationStatus: participant.participationStatus,
    firstJoined: participant.firstJoined,
    // CloudShare uses "0" as a pre-registration placeholder before an
    // environment exists. Do not persist it as an environment correlation.
    environmentId: participant.envId === "0" ? null : participant.envId,
    envStatus: participant.envStatus,
  };
}

function participantEvidence(evidence: SalesDeliveryEvidence): SalesDeliveryEvidence {
  return evidence;
}

function participantPage(data: z.output<typeof participantsEnvelopeSchema>): { readonly count?: number; readonly participants: readonly z.output<typeof salesParticipantSchema>[] } {
  return participantsEnvelopeSchema.parse(data);
}

function hasDuplicateParticipantIds(participants: readonly z.output<typeof salesParticipantSchema>[]): boolean {
  return new Set(participants.map((participant) => participant.id)).size !== participants.length;
}

type ParticipantPageFailureMode = "participant_page_count_contradiction" | "participant_page_duplicate_id";

function throwParticipantPageFailure(evidence: SalesDeliveryEvidence, expectedCount: number, returnedCount: number, pageOffsets: readonly number[], failureMode: ParticipantPageFailureMode): never {
  const safeEvidence = participantEvidence(evidence);
  throw new CloudShareResponseError(failureMode === "participant_page_duplicate_id" ? "CloudShare participant page contains duplicate IDs." : "CloudShare participant page count contradicts the returned items.", {
    method: safeEvidence.request.method,
    path: safeEvidence.request.path,
    ...(safeEvidence.request.query ? { requestQuery: safeEvidence.request.query } : {}),
    ...(safeEvidence.request.headers ? { requestHeaders: safeEvidence.request.headers } : {}),
    ...(safeEvidence.request.body !== undefined ? { requestBody: safeEvidence.request.body } : {}),
    status: safeEvidence.response.status,
    responseStatus: safeEvidence.response.status,
    ...(safeEvidence.response.headers ? { responseHeaders: safeEvidence.response.headers } : {}),
    responseBody: safeEvidence.response.body,
    expectedCount,
    returnedCount,
    failureMode,
  });
}

function hasEveryMutableSalesExperienceField(value: z.infer<typeof salesExperienceSchema>): boolean {
  const record = value as Record<string, unknown>;
  return mutableSalesExperienceFields.every((field) => Object.hasOwn(record, field) && record[field] !== undefined);
}
