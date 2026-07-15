import { z } from "zod";
import type { SalesExperienceType } from "@/domain/item";
import type { CloudShareClient, CloudShareDetailedResult, CloudShareRequestDiagnostics, CloudShareResponseDiagnostics } from "./client";

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
  /** PUT always starts from a documented full GET representation; callers may
   * alter only provider-visible name and schedule/timezone fields. */
  updateSession?(salesExperienceId: string, changes: { readonly name?: string; readonly start?: string; readonly end?: string | null; readonly timeZone?: string }): Promise<{ readonly id: string } & SalesDeliveryEvidence>;
}

const salesExperienceSchema = z.object({ id: z.string().min(1), name: z.string().min(1).optional(), status: z.string().optional(), type: z.enum(["demo", "poc", "pov", "trial"]).optional(), projectId: z.string().min(1).optional(), blueprintIds: z.array(z.string()).min(1).optional(), cloudshareRegionIds: z.array(z.string()).min(1).optional(), policyId: z.string().min(1).optional(), opportunity: z.string().min(1).optional(), mainSalesPro: z.object({ email: z.string().email(), teamId: z.string().optional() }).optional(), registrationType: z.enum(["registeredParticipantsOnly", "anyParticipants"]).optional(), start: z.string().optional(), end: z.string().nullable().optional(), timeZone: z.string().optional() }).passthrough();

/** The deep CloudShare Sales Delivery module. Callers never learn v4 paths,
 * wire keys, or response parsing; they only validate an owner and create a
 * time-bounded registered-only delivery. */
export function createCloudShareSalesDelivery(client: CloudShareClient): SalesDelivery {
  async function detailed<T>(spec: { method: "GET" | "POST" | "PUT"; path: string; body?: unknown; schema: z.ZodType<T> }): Promise<{ data: T; evidence: SalesDeliveryEvidence }> {
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
      const required = [current.name, current.type, current.projectId, current.blueprintIds, current.cloudshareRegionIds, current.policyId, current.opportunity, current.mainSalesPro, current.registrationType, current.start, current.timeZone];
      if (required.some((value) => value === undefined || value === null)) throw new Error("CloudShare did not return the complete documented Sales Experience required for a safe update.");
      const body = { ...current, ...changes, id: undefined, status: undefined };
      delete (body as Record<string, unknown>).id; delete (body as Record<string, unknown>).status;
      const { data, evidence } = await detailed({ method: "PUT", path: `/sales/${encodeURIComponent(salesExperienceId)}`, body, schema: salesExperienceSchema });
      return { id: data.id, ...evidence };
    },
  };
}
