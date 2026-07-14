import { z } from "zod";
import type { SalesExperienceType } from "@/domain/item";
import type { CloudShareClient, CloudShareDetailedResult } from "./client";

export interface SalesDeliveryRequestEvidence { readonly method: string; readonly path: string; readonly body?: unknown; }
export interface SalesDeliveryResponseEvidence { readonly status: number; readonly body: unknown; }
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
  readonly start: string;
  readonly end: string;
  readonly timeZone: string;
  readonly mainSalesProEmail: string;
  readonly registrationType: "registeredParticipantsOnly";
  readonly sendInvitations: "dontSend";
}
export interface SalesDelivery {
  validateMainSalesPro(input: { readonly projectId: string; readonly email: string }): Promise<SalesDeliveryEvidence>;
  createSession(input: CreateSalesDemoSessionInput): Promise<{ readonly salesExperienceId: string } & SalesDeliveryEvidence>;
}

const salesProListSchema = z.object({ salesPros: z.array(z.object({ email: z.string().email() })).default([]) });
const salesExperienceSchema = z.object({ id: z.string().min(1) });

/** The deep CloudShare Sales Delivery module. Callers never learn v4 paths,
 * wire keys, or response parsing; they only validate an owner and create a
 * time-bounded registered-only delivery. */
export function createCloudShareSalesDelivery(client: CloudShareClient): SalesDelivery {
  async function detailed<T>(spec: { method: "GET" | "POST"; path: string; body?: unknown; schema: z.ZodType<T> }): Promise<{ data: T; evidence: SalesDeliveryEvidence }> {
    const result = client.requestV4Detailed
      ? await client.requestV4Detailed(spec)
      : await client.requestV4(spec).then((data) => ({ data, request: { method: spec.method, path: spec.path, ...(spec.body === undefined ? {} : { body: spec.body }) }, response: { status: 200, body: data } } as CloudShareDetailedResult<T>));
    return { data: result.data, evidence: { request: { method: result.request.method, path: result.request.path, ...(result.request.body === undefined ? {} : { body: result.request.body }) }, response: { status: result.response.status, body: result.response.body } } };
  }
  return {
    async validateMainSalesPro({ projectId, email }) {
      // The documented direct-v4 listing is the Sales-Pro availability read used
      // by the configured Project. Keep the wire request inside this adapter.
      const { data, evidence } = await detailed({ method: "GET", path: "/salespros", schema: salesProListSchema });
      if (!(data.salesPros ?? []).some((salesPro) => salesPro.email.toLowerCase() === email.toLowerCase())) {
        throw new SalesMainProValidationError(`The authenticated Sales Admin is not an eligible CloudShare main Sales Pro for Project ${projectId}.`, evidence);
      }
      return evidence;
    },
    async createSession(input) {
      const body = { name: input.name, type: input.type, projectId: input.projectId, blueprintIds: input.blueprintIds, cloudshareRegionIds: input.regionIds, policyId: input.policyId, opportunity: input.opportunity, externalId: input.externalId, start: input.start, end: input.end, timeZone: input.timeZone, mainSalesPro: { email: input.mainSalesProEmail }, registrationType: input.registrationType, sendInvitations: input.sendInvitations };
      const { data, evidence } = await detailed({ method: "POST", path: "/sales", body, schema: salesExperienceSchema });
      return { salesExperienceId: data.id, ...evidence };
    },
  };
}

export class SalesMainProValidationError extends Error {
  constructor(message: string, readonly evidence?: SalesDeliveryEvidence) { super(message); this.name = "SalesMainProValidationError"; }
}
