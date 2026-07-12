import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CloudShareClientFactory, CloudShareConnectionRepository } from "@/domain/cloudshare-connection";
import type { DiagnosticActor, DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { AuditRepository } from "@/domain/audit-trail";
import { archiveDemoItem, createDemoItem, DemoItemNotFoundError, DemoItemValidationError, type DemoItemRepository, updateDemoItem } from "@/domain/demo-item";
import { CloudShareError } from "@/integrations/cloudshare";
import { CloudShareSalesResourceReadError, createCloudShareExamAuthoringSource, createCloudShareSalesDemoItemResourceSource, type CloudShareExamAuthoringSource, type CloudShareDetailedResourceRead } from "@/integrations/cloudshare/resources";

const writeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(""),
  projectId: z.string().trim().min(1),
  blueprintIds: z.array(z.string().trim().min(1)).min(1),
  policyId: z.string().trim().min(1),
  regionId: z.string().trim().min(1),
  salesExperienceType: z.enum(["demo", "poc", "pov", "trial"]),
});

type WriteRequest = z.infer<typeof writeSchema>;
export interface SalesDemoItemDeps {
  readonly repository: DemoItemRepository;
  readonly connections: Pick<CloudShareConnectionRepository, "findByCustomerId">;
  readonly cloudshare: Pick<CloudShareClientFactory, "forConnection">;
  readonly diagnostics?: DiagnosticRecorder;
  readonly audit?: Pick<AuditRepository, "write">;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface SalesDemoItemRequest {
  readonly customerId: string;
  readonly actor?: DiagnosticActor | null;
  readonly body?: unknown;
}

function response(status: number, body: Record<string, unknown>) { return { status, body }; }

export async function handleListSalesDemoItems(deps: Pick<SalesDemoItemDeps, "repository">, request: { customerId: string }) {
  const items = await deps.repository.listByCustomerId(request.customerId);
  return response(200, { activeDemoItems: items.filter((item) => item.status === "active"), archivedDemoItems: items.filter((item) => item.status === "archived") });
}

export async function handleGetSalesDemoItem(deps: Pick<SalesDemoItemDeps, "repository">, request: { customerId: string; id: string }) {
  const item = await deps.repository.findById(request.id);
  return !item || item.customerId !== request.customerId ? response(404, { error: "Demo Item was not found for this Customer." }) : response(200, { demoItem: item });
}

export async function handleCreateSalesDemoItem(deps: SalesDemoItemDeps, request: SalesDemoItemRequest) {
  return save(deps, request, null);
}

export async function handleUpdateSalesDemoItem(deps: SalesDemoItemDeps, request: SalesDemoItemRequest & { readonly id: string }) {
  return save(deps, request, request.id);
}

async function save(deps: SalesDemoItemDeps, request: SalesDemoItemRequest, id: string | null) {
  const parsed = writeSchema.safeParse(request.body);
  if (!parsed.success) return response(400, { error: "Invalid Demo Item authoring request.", issues: parsed.error.flatten().fieldErrors });
  const connection = await deps.connections.findByCustomerId(request.customerId);
  if (!connection) return response(404, { error: "Save a Certalis CloudShare Connection before authoring Demo Items." });

  try {
    const correlationId = randomUUID();
    const live = await resolveLiveSelections(deps, request, connection, parsed.data, correlationId);
    const input = { customerId: request.customerId, name: parsed.data.name, description: parsed.data.description, project: live.project, blueprints: live.blueprints, policy: live.policy, region: live.region, salesExperienceType: parsed.data.salesExperienceType, defaultDurationMinutes: live.defaultDurationMinutes };
    const item = id
      ? await updateDemoItem({ repository: deps.repository, now: deps.now }, { id, ...input })
      : await createDemoItem({ repository: deps.repository, now: deps.now, newId: deps.newId }, input);
    await deps.diagnostics?.record({ source: "sales-demo-items", operation: id ? "sales.demo_item.updated" : "sales.demo_item.created", outcome: "success", customerId: request.customerId, actor: request.actor, subject: { type: "demo_item", id: item.id }, correlationId, message: `Demo Item ${id ? "updated" : "created"} from live CloudShare resources`, externalIds: { demoItemId: item.id, projectId: item.project.id, policyId: item.policy.id, regionId: item.region.id }, details: { integrationSurface: "cloudshare.v3.authoring_resources", blueprintCount: item.blueprints.length, defaultDurationMinutes: item.defaultDurationMinutes } });
    await writeAudit(deps, request, item.id, id ? "sales.demo_item.updated" : "sales.demo_item.created", "success", correlationId, { projectId: item.project.id, blueprintIds: item.blueprints.map((blueprint) => blueprint.id), policyId: item.policy.id, regionId: item.region.id });
    return response(id ? 200 : 201, { demoItem: item });
  } catch (error) {
    if (error instanceof DemoItemValidationError) return response(400, { error: error.message });
    if (error instanceof DemoItemNotFoundError) return response(404, { error: error.message });
    const correlationId = randomUUID();
    const typed = error instanceof CloudShareError;
    const diagnostic = { operation: "sales.demo_item.authoring_resources.read", integrationSurface: "cloudshare.v3.authoring_resources", failureMode: typed ? cloudShareFailureMode(error) : "resource_selection", ...(typed && error.context?.status ? { responseStatus: error.context.status } : {}) };
    await deps.diagnostics?.record({ source: "sales-demo-items", operation: "sales.demo_item.authoring_resources.read", outcome: "failure", level: "warn", customerId: request.customerId, actor: request.actor, correlationId, message: "Demo Item resource validation failed", request: typed ? diagnosticRequest(error) : { method: "GET", path: "/projects" }, response: typed ? diagnosticResponse(error) : {}, details: diagnostic });
    await writeAudit(deps, request, id ?? "unpersisted", id ? "sales.demo_item.updated" : "sales.demo_item.created", "failure", correlationId, null);
    return response(typed ? 502 : 400, { error: typed ? "CloudShare resource validation failed. Review support diagnostics." : error instanceof Error ? error.message : "Unable to validate the selected CloudShare resources.", correlationId, diagnostic });
  }
}

export async function handleArchiveSalesDemoItem(deps: Pick<SalesDemoItemDeps, "repository" | "diagnostics" | "audit" | "now">, request: { readonly customerId: string; readonly actor?: DiagnosticActor | null; readonly id: string }) {
  try {
    const item = await archiveDemoItem({ repository: deps.repository, now: deps.now }, request);
    const correlationId = randomUUID();
    await deps.diagnostics?.record({ source: "sales-demo-items", operation: "sales.demo_item.archived", outcome: "success", customerId: request.customerId, actor: request.actor, subject: { type: "demo_item", id: item.id }, correlationId, message: "Demo Item archived; it remains history-only and cannot start a Sales Demo Session.", externalIds: { demoItemId: item.id } });
    await writeAudit(deps, request, item.id, "sales.demo_item.archived", "success", correlationId, null);
    return response(200, { demoItem: item });
  } catch (error) { await writeAudit(deps, request, request.id, "sales.demo_item.archived", "failure", randomUUID(), null); return response(error instanceof DemoItemNotFoundError ? 404 : 400, { error: error instanceof Error ? error.message : "Unable to archive Demo Item." }); }
}

async function resolveLiveSelections(deps: Pick<SalesDemoItemDeps, "cloudshare" | "diagnostics">, request: SalesDemoItemRequest, connection: Exclude<Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>, null>, input: WriteRequest, correlationId: string) {
  const candidate = deps.cloudshare.forConnection(connection) as unknown;
  if (!(typeof candidate === "object" && candidate !== null && "listProjects" in candidate)) {
    const detailed = createCloudShareSalesDemoItemResourceSource(candidate as Parameters<typeof createCloudShareSalesDemoItemResourceSource>[0]);
    const projects = await detailed.readProjects(); await recordSalesResourceRead(deps, request, correlationId, projects, "project");
    const regions = await detailed.readRegions(); await recordSalesResourceRead(deps, request, correlationId, regions, "region");
    const blueprints = await detailed.readProjectBlueprints(input.projectId); await recordSalesResourceRead(deps, request, correlationId, blueprints, "blueprint");
    let policies;
    try { policies = await detailed.readProjectPolicies(input.projectId); } catch (error) {
      if (error instanceof CloudShareSalesResourceReadError) {
        for (const read of error.completedReads) await recordSalesResourceRead(deps, request, correlationId, read, read.integrationSurface.endsWith("policy_detail") ? "policy_detail" : "policy");
        throw error.cause;
      }
      throw error;
    }
    for (const read of policies.reads) await recordSalesResourceRead(deps, request, correlationId, read, read.integrationSurface.endsWith("policy_detail") ? "policy_detail" : "policy");
    return selectLiveResources(projects.data, regions.data, blueprints.data, policies.policies, input);
  }
  const source: CloudShareExamAuthoringSource = typeof candidate === "object" && candidate !== null && "listProjects" in candidate
    ? candidate as CloudShareExamAuthoringSource
    : createCloudShareExamAuthoringSource(candidate as Parameters<typeof createCloudShareExamAuthoringSource>[0]);
  const [projects, regions, blueprints, policies] = await Promise.all([source.listProjects(), source.listRegions(), source.listProjectBlueprints(input.projectId), source.listProjectPolicies(input.projectId)]);
  await deps.diagnostics?.record({ source: "sales-demo-items", operation: "sales.demo_item.authoring_resources.read", outcome: "success", customerId: request.customerId, actor: request.actor, correlationId, message: "Live CloudShare resources revalidated for Demo Item authoring", request: { method: "GET", path: "/projects" }, response: { status: 200, body: { itemCount: projects.length } }, details: { integrationSurface: "cloudshare.v3.projects" }, externalIds: { resourceType: "project" } });
  await deps.diagnostics?.record({ source: "sales-demo-items", operation: "sales.demo_item.authoring_resources.read", outcome: "success", customerId: request.customerId, actor: request.actor, correlationId, message: "Live CloudShare resources revalidated for Demo Item authoring", request: { method: "GET", path: "/regions" }, response: { status: 200, body: { itemCount: regions.length } }, details: { integrationSurface: "cloudshare.v3.regions" }, externalIds: { resourceType: "region" } });
  await deps.diagnostics?.record({ source: "sales-demo-items", operation: "sales.demo_item.authoring_resources.read", outcome: "success", customerId: request.customerId, actor: request.actor, correlationId, message: "Live CloudShare resources revalidated for Demo Item authoring", request: { method: "GET", path: `/projects/${input.projectId}/blueprints` }, response: { status: 200, body: { itemCount: blueprints.length } }, details: { integrationSurface: "cloudshare.v3.projects.blueprints" }, externalIds: { resourceType: "blueprint", projectId: input.projectId } });
  await deps.diagnostics?.record({ source: "sales-demo-items", operation: "sales.demo_item.authoring_resources.read", outcome: "success", customerId: request.customerId, actor: request.actor, correlationId, message: "Live CloudShare resources revalidated for Demo Item authoring", request: { method: "GET", path: `/projects/${input.projectId}/policies` }, response: { status: 200, body: { itemCount: policies.length } }, details: { integrationSurface: "cloudshare.v3.projects.policies" }, externalIds: { resourceType: "policy", projectId: input.projectId } });
  return selectLiveResources(projects, regions, blueprints, policies, input);
}

function selectLiveResources(projects: Array<{ id: string; name: string }>, regions: Array<{ id: string; name: string; friendlyName?: string }>, blueprints: Array<{ id: string; name: string }>, policies: Array<{ id: string; name: string; storageLeaseMinutes?: number | null }>, input: WriteRequest) {
  const project = projects.find((item) => item.id === input.projectId);
  const region = regions.find((item) => item.id === input.regionId);
  const policy = policies.find((item) => item.id === input.policyId);
  const ordered = input.blueprintIds.map((id) => blueprints.find((blueprint) => blueprint.id === id));
  if (!project || !region || !policy || ordered.some((blueprint) => !blueprint)) throw new DemoItemValidationError("One or more selected resources are no longer available from the Certalis CloudShare Connection. Refresh and select by name again.");
  if (!policy.storageLeaseMinutes) throw new DemoItemValidationError("The selected Policy does not expose a storage lease, so it cannot provide a default Sales Demo duration.");
  return { project, region: { id: region.id, name: region.friendlyName ?? region.name }, policy: { id: policy.id, name: policy.name }, blueprints: ordered as Array<{ id: string; name: string }>, defaultDurationMinutes: policy.storageLeaseMinutes };
}

async function recordSalesResourceRead(deps: Pick<SalesDemoItemDeps, "diagnostics">, request: SalesDemoItemRequest, correlationId: string, read: CloudShareDetailedResourceRead<unknown>, resourceType: string) {
  await deps.diagnostics?.record({ source: "sales-demo-items", operation: "sales.demo_item.authoring_resources.read", outcome: "success", customerId: request.customerId, actor: request.actor, correlationId, message: `${resourceType} resource read succeeded`, request: read.request, response: read.response, details: { integrationSurface: read.integrationSurface }, externalIds: { resourceType } });
}

async function writeAudit(deps: Pick<SalesDemoItemDeps, "audit">, request: { customerId: string; actor?: DiagnosticActor | null }, subjectId: string, action: string, outcome: "success" | "failure", correlationId: string, details: Record<string, unknown> | null) {
  await deps.audit?.write({ id: randomUUID(), occurredAt: new Date(), customerId: request.customerId, actorType: request.actor?.type ?? null, actorId: request.actor?.id ?? null, actorEmail: request.actor?.email ?? null, action, subjectType: "demo_item", subjectId, outcome, correlationId, details });
}

function cloudShareFailureMode(error: CloudShareError): string { return error.name === "CloudShareTransportError" ? "transport" : error.name === "CloudShareResponseError" ? "unexpected_response" : error.name === "CloudShareRateLimitError" ? "rate_limit" : "http_status"; }
function diagnosticRequest(error: CloudShareError): Record<string, unknown> { return { method: error.context?.method ?? "GET", path: error.context?.path ?? "/projects", ...(error.context?.requestHeaders ? { headers: error.context.requestHeaders } : {}), ...(error.context?.requestBody !== undefined ? { body: error.context.requestBody } : {}) }; }
function diagnosticResponse(error: CloudShareError): Record<string, unknown> { return { ...(error.context?.status ? { status: error.context.status } : {}), ...(error.context?.responseHeaders ? { headers: error.context.responseHeaders } : {}), ...(error.context?.responseBody !== undefined ? { body: error.context.responseBody } : {}), ...(error.context?.cause !== undefined ? { cause: normalizeTransportCause(error.context.cause) } : {}), ...(error.context?.network !== undefined ? { network: error.context.network } : {}), ...(error.context?.tls !== undefined ? { tls: error.context.tls } : {}) }; }
function normalizeTransportCause(cause: unknown): unknown { return cause instanceof Error ? { name: cause.name, message: cause.message } : cause; }
