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
  readonly sendInvitations: "dontSend";
}
export interface SalesDelivery {
  createSession(input: CreateSalesDemoSessionInput): Promise<{ readonly salesExperienceId: string } & SalesDeliveryEvidence>;
  /** Documented v4 read used only for reconciliation; the ID remains server-side. */
  readSession(salesExperienceId: string): Promise<{ readonly id: string; readonly status?: string } & SalesDeliveryEvidence>;
  /** PUT always starts from a documented full GET representation. Certalis
   * changes only the provider-visible name: schedule edits need their own
   * lifecycle policy before they can be exposed. */
  updateSession?(salesExperienceId: string, changes: { readonly name: string }): Promise<{ readonly id: string } & SalesDeliveryEvidence>;
  registerParticipants(salesExperienceId: string, participants: readonly SalesParticipantInput[]): Promise<{ readonly participants: readonly SalesParticipant[] } & SalesDeliveryEvidence>;
  listParticipants(salesExperienceId: string): Promise<{ readonly participants: readonly SalesParticipant[] } & SalesDeliveryEvidence>;
  inviteParticipants(salesExperienceId: string, participantIds: readonly string[]): Promise<SalesDeliveryEvidence>;
}

export interface SalesParticipantInput { readonly firstName: string; readonly lastName: string; readonly email: string; }
/** Browser-safe monitoring read model. Invite URLs are not part of this documented response. */
export interface SalesParticipant extends SalesParticipantInput {
  readonly id: string; readonly invitationStatus: "sent" | "notSent"; readonly invitedBy: string | null;
  readonly participationStatus: "pending" | "inProgress" | "concluded"; readonly firstJoined: string | null;
  /** Server-only CloudShare correlation; never include it in portal projections. */
  readonly environmentId: string | null;
  readonly envStatus?: string;
}

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
const salesParticipantSchema = z.object({
  id: z.string().min(1), firstName: z.string(), lastName: z.string(), email: z.string().email(),
  invitationStatus: z.enum(["sent", "notSent"]).default("notSent"), invitedBy: z.string().email().nullable().optional().default(null),
  participationStatus: z.enum(["pending", "inProgress", "concluded"]).default("pending"), firstJoined: z.string().nullable().optional().default(null), envStatus: z.string().optional(), envId: z.string().nullable().optional().default(null),
}).passthrough();
/** The initial v4 export describes `participants`; live Sales reads return
 * the normal paged collection `{ count, items }`. Accept both during the
 * product documentation transition and normalize before leaving this adapter. */
const participantsEnvelopeSchema = z.union([
  z.object({ count: z.number().int().nonnegative(), participants: z.array(salesParticipantSchema) }),
  z.object({ count: z.number().int().nonnegative(), items: z.array(salesParticipantSchema) }),
  z.object({ participants: z.array(salesParticipantSchema) }),
]);
const PARTICIPANT_PAGE_LIMIT = 100;

const mutableSalesExperienceFields = ["name", "type", "projectId", "teamId", "blueprintIds", "allowParticipantsSwitchSteps", "cloudshareRegionIds", "awsCloudRegion", "azureCloudRegion", "googleCloudProviderRegion", "googleCloudProviderZone", "policyId", "opportunity", "mainSalesPro", "additionalSalesPros", "start", "end", "timeZone", "registrationType", "passphrase", "description", "labels", "externalId", "allowMultipleEnvironmentActivations", "sendInvitations", "emailDomainBlocklist", "blockFreeEmailDomains", "customFields", "useCustomInvitationEmail", "preConfigureParticipantEnvironments", "sharedEnvBlueprintId", "sharedEnvPolicyId", "isSharedLabViewAccessEnabled", "allowAudioVideo"] as const;

/** The deep CloudShare Sales Delivery module. Callers never learn v4 paths,
 * wire keys, or response parsing; they only validate an owner and create a
 * time-bounded registered-only delivery. */
export function createCloudShareSalesDelivery(client: CloudShareClient): SalesDelivery {
  async function detailed<T>(spec: { method: "GET" | "POST" | "PUT"; path: string; query?: Record<string, string>; body?: unknown; allowEmptyResponse?: boolean; schema: z.ZodType<T> }): Promise<{ data: T; evidence: SalesDeliveryEvidence }> {
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
      return { id: data.id, ...(typeof (data as { status?: unknown }).status === "string" ? { status: (data as { status: string }).status } : {}), ...evidence };
    },
    async updateSession(salesExperienceId, changes) {
      const { data: current } = await detailed({ method: "GET", path: `/sales/${encodeURIComponent(salesExperienceId)}`, schema: salesExperienceSchema });
      if (!hasEveryMutableSalesExperienceField(current) || current.sendInvitations !== "dontSend") throw new Error("CloudShare did not return the complete documented Sales Experience required for a safe update.");
      // Sales_Experience declares many defaults. Copy every documented mutable
      // value that CloudShare returned, rather than permitting a full PUT to
      // silently reset settings outside Certalis' edit scope. Invitations are
      // deliberately pinned to the portal's no-invitation safety invariant.
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
    async registerParticipants(salesExperienceId, participants) {
      const { data, evidence } = await detailed({ method: "POST", path: `/sales/${encodeURIComponent(salesExperienceId)}/participants`, body: participants, schema: z.array(salesParticipantSchema) });
      return { participants: data.map(mapSalesParticipant), ...participantEvidence(evidence, data.length) };
    },
    async listParticipants(salesExperienceId) {
      const path = `/sales/${encodeURIComponent(salesExperienceId)}/participants`;
      const first = await detailed({ method: "GET", path, query: { offset: "0", limit: String(PARTICIPANT_PAGE_LIMIT) }, schema: participantsEnvelopeSchema });
      const firstPage = participantPage(first.data);
      if (firstPage.count === undefined) {
        return { participants: firstPage.participants.map(mapSalesParticipant), ...participantEvidence(first.evidence, firstPage.participants.length, [0]) };
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
        const page = await detailed({ method: "GET", path, query: { offset: String(offset), limit: String(PARTICIPANT_PAGE_LIMIT) }, schema: participantsEnvelopeSchema });
        const normalizedPage = participantPage(page.data);
        offsets.push(offset);
        const returnedCount = rows.length + normalizedPage.participants.length;
        if (hasDuplicateParticipantIds(normalizedPage.participants) || normalizedPage.participants.some((participant) => participantIds.has(participant.id))) throwParticipantPageFailure(page.evidence, expectedCount, returnedCount, offsets, "participant_page_duplicate_id");
        if (normalizedPage.count !== expectedCount || normalizedPage.participants.length === 0 || returnedCount > expectedCount) throwParticipantPageFailure(page.evidence, expectedCount, returnedCount, offsets, "participant_page_count_contradiction");
        normalizedPage.participants.forEach((participant) => participantIds.add(participant.id));
        rows.push(...normalizedPage.participants);
        evidence = page.evidence;
      }
      return { participants: rows.map(mapSalesParticipant), ...participantEvidence(evidence, expectedCount, offsets) };
    },
    async inviteParticipants(salesExperienceId, participantIds) {
      const { evidence } = await detailed({ method: "POST", path: `/sales/${encodeURIComponent(salesExperienceId)}/participants/invite`, body: participantIds, allowEmptyResponse: true, schema: z.void() });
      return participantEvidence(evidence, participantIds.length);
    },
  };
}

function mapSalesParticipant(participant: z.input<typeof salesParticipantSchema>): SalesParticipant {
  return {
    id: participant.id,
    firstName: participant.firstName,
    lastName: participant.lastName,
    email: participant.email,
    invitationStatus: participant.invitationStatus ?? "notSent",
    invitedBy: participant.invitedBy ?? null,
    participationStatus: participant.participationStatus ?? "pending",
    firstJoined: participant.firstJoined ?? null,
    environmentId: participant.envId ?? null,
    ...(participant.envStatus === undefined ? {} : { envStatus: participant.envStatus }),
  };
}

/** Participant e-mail and native invitation credentials are never diagnostic
 * payload data. Keep transport facts, page query, and a count for support. */
function participantEvidence(evidence: SalesDeliveryEvidence, participantCount: number, pageOffsets?: readonly number[]): SalesDeliveryEvidence {
  return {
    request: {
      ...evidence.request,
      ...(evidence.request.body === undefined ? {} : { body: { participantCount } }),
    },
    response: { ...evidence.response, body: { participantCount, ...(pageOffsets ? { pageCount: pageOffsets.length, pageOffsets } : {}) } },
  };
}

function participantPage(data: z.input<typeof participantsEnvelopeSchema>): { readonly count?: number; readonly participants: readonly z.input<typeof salesParticipantSchema>[] } {
  if ("items" in data) return { count: data.count, participants: data.items };
  if ("count" in data) return { count: data.count, participants: data.participants };
  return { participants: data.participants };
}

function hasDuplicateParticipantIds(participants: readonly z.input<typeof salesParticipantSchema>[]): boolean {
  return new Set(participants.map((participant) => participant.id)).size !== participants.length;
}

type ParticipantPageFailureMode = "participant_page_count_contradiction" | "participant_page_duplicate_id";

function throwParticipantPageFailure(evidence: SalesDeliveryEvidence, expectedCount: number, returnedCount: number, pageOffsets: readonly number[], failureMode: ParticipantPageFailureMode): never {
  const safeEvidence = participantEvidence(evidence, returnedCount, pageOffsets);
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
