import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CloudShareClientFactory, CloudShareConnectionRepository } from "@/domain/cloudshare-connection";
import type { DiagnosticActor, DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { AuditRepository } from "@/domain/audit-trail";
import { archiveItem, createItem, ItemNotFoundError, ItemValidationError, type ItemRepository, updateItem } from "@/domain/item";
import { CloudShareError } from "@/integrations/cloudshare";
import { projectCloudShareFailureEvidence } from "@/integrations/cloudshare/diagnostic-failure-projection";
import { CloudShareSalesResourceReadError, createCloudShareExamAuthoringSource, createCloudShareSalesItemResourceSource, type CloudShareBlueprintDetail, type CloudShareDetailedResourceRead, type CloudShareExamAuthoringSource } from "@/integrations/cloudshare/resources";

const writeSchema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(2000).default(""), projectId: z.string().trim().min(1), blueprintIds: z.array(z.string().trim().min(1)).min(1), policyId: z.string().trim().min(1), regionIds: z.array(z.string().trim().min(1)).min(1) });
type WriteRequest = z.infer<typeof writeSchema>;
export interface SalesItemDeps { readonly repository: ItemRepository; readonly connections: Pick<CloudShareConnectionRepository, "findByCustomerId">; readonly cloudshare: Pick<CloudShareClientFactory, "forConnection">; readonly diagnostics?: DiagnosticRecorder; readonly audit?: Pick<AuditRepository, "write">; readonly now?: () => Date; readonly newId?: () => string; }
export interface SalesItemRequest { readonly customerId: string; readonly actor?: DiagnosticActor | null; readonly body?: unknown; }
const response = (status: number, body: Record<string, unknown>) => ({ status, body });

/** Reads the default-Snapshot Region coverage used by the Item form. This remains
 * an API handler seam so every live read has Customer-scoped, redacted evidence. */
export async function handleGetSalesItemBlueprintDetails(
  deps: Pick<SalesItemDeps, "connections" | "cloudshare" | "diagnostics">,
  request: { readonly customerId: string; readonly actor?: DiagnosticActor | null; readonly projectId: string; readonly blueprintIds: readonly string[] },
) {
  const connection = await deps.connections.findByCustomerId(request.customerId);
  if (!connection) return response(404, { error: "Save a Certalis CloudShare Connection before authoring Items." });
  const correlationId = randomUUID();
  try {
    const client = deps.cloudshare.forConnection(connection) as Parameters<typeof createCloudShareSalesItemResourceSource>[0];
    const source = createCloudShareSalesItemResourceSource(client);
    let reads: readonly CloudShareDetailedResourceRead<CloudShareBlueprintDetail>[];
    try {
      reads = await source.readProjectBlueprintDetails(request.projectId, request.blueprintIds);
    } catch (error) {
      if (error instanceof CloudShareSalesResourceReadError) {
        for (const read of error.completedReads) await record(deps, request, correlationId, read, "blueprint_detail");
        throw error.cause;
      }
      throw error;
    }
    for (const read of reads) await record(deps, request, correlationId, read, "blueprint_detail");
    return response(200, { blueprintDetails: reads.map((read) => ({ id: read.data.id, defaultSnapshotRegionIds: read.data.snapshots.find((snapshot) => snapshot.isDefault)?.regionIds ?? [] })) });
  } catch (error) {
    const cloudShareError = error instanceof CloudShareError ? error : undefined;
    const typed = Boolean(cloudShareError);
    const evidence = cloudShareError ? projectCloudShareFailureEvidence(cloudShareError) : undefined;
    const oauthFailure = evidence?.request === null && evidence.response === null;
    const diagnostic = { operation: "sales.item.authoring_resources.read", integrationSurface: oauthFailure && typeof cloudShareError?.context?.integrationSurface === "string" ? cloudShareError.context.integrationSurface : "cloudshare.v3.projects.blueprint_detail", failureMode: cloudShareError ? failureMode(cloudShareError) : "unexpected_response", ...(typeof cloudShareError?.context?.status === "number" ? { responseStatus: cloudShareError.context.status } : {}) };
    await deps.diagnostics?.record({ source: "sales-items", operation: "sales.item.authoring_resources.read", outcome: "failure", level: "warn", customerId: request.customerId, actor: request.actor, correlationId, message: "Item Blueprint-detail resource read failed", request: typed ? evidence?.request : { method: "GET", path: `/projects/${request.projectId}/blueprints` }, response: typed ? evidence?.response : {}, details: diagnostic, externalIds: { projectId: request.projectId, resourceType: "blueprint_detail" } });
    return response(502, { error: "CloudShare Blueprint detail validation failed. Review support diagnostics.", correlationId, diagnostic });
  }
}

export async function handleListSalesItems(deps: Pick<SalesItemDeps, "repository">, request: { customerId: string }) { const items = await deps.repository.listByCustomerId(request.customerId); return response(200, { activeItems: items.filter((item) => item.status === "active"), archivedItems: items.filter((item) => item.status === "archived") }); }
export async function handleGetSalesItem(deps: Pick<SalesItemDeps, "repository">, request: { customerId: string; id: string }) { const item = await deps.repository.findById(request.id); return !item || item.customerId !== request.customerId ? response(404, { error: "Item was not found for this Customer." }) : response(200, { item }); }
export const handleCreateSalesItem = (deps: SalesItemDeps, request: SalesItemRequest) => save(deps, request, null);
export const handleUpdateSalesItem = (deps: SalesItemDeps, request: SalesItemRequest & { readonly id: string }) => save(deps, request, request.id);

async function save(deps: SalesItemDeps, request: SalesItemRequest, id: string | null) {
  const parsed = writeSchema.safeParse(request.body);
  if (!parsed.success) return response(400, { error: "Invalid Item authoring request.", issues: parsed.error.flatten().fieldErrors });
  const connection = await deps.connections.findByCustomerId(request.customerId);
  if (!connection) return response(404, { error: "Save a Certalis CloudShare Connection before authoring Items." });
  const correlationId = randomUUID();
  try {
    const live = await resolveLiveSelections(deps, request, connection, parsed.data, correlationId);
    const input = { customerId: request.customerId, name: parsed.data.name, description: parsed.data.description, project: live.project, blueprints: live.blueprints, policy: live.policy, regions: live.regions, defaultDurationMinutes: live.defaultDurationMinutes };
    const item = id ? await updateItem({ repository: deps.repository, now: deps.now }, { id, ...input }) : await createItem({ repository: deps.repository, now: deps.now, newId: deps.newId }, input);
    await deps.diagnostics?.record({ source: "sales-items", operation: id ? "sales.item.updated" : "sales.item.created", outcome: "success", customerId: request.customerId, actor: request.actor, subject: { type: "item", id: item.id }, correlationId, message: `Item ${id ? "updated" : "created"} from live CloudShare resources`, externalIds: { itemId: item.id, projectId: item.project.id, policyId: item.policy.id, regionIds: item.regions.map((region) => region.id).join(",") }, details: { integrationSurface: "cloudshare.v3.authoring_resources", blueprintCount: item.blueprints.length, defaultDurationMinutes: item.defaultDurationMinutes } });
    await audit(deps, request, item.id, id ? "sales.item.updated" : "sales.item.created", "success", correlationId, { projectId: item.project.id, blueprintIds: item.blueprints.map((blueprint) => blueprint.id), policyId: item.policy.id, regionIds: item.regions.map((region) => region.id) });
    return response(id ? 200 : 201, { item });
  } catch (error) {
    const cloudShareError = error instanceof CloudShareError ? error : undefined;
    const typed = Boolean(cloudShareError);
    const evidence = cloudShareError ? projectCloudShareFailureEvidence(cloudShareError) : undefined;
    const oauthFailure = evidence?.request === null && evidence.response === null;
    const diagnostic = { operation: "sales.item.authoring_resources.read", integrationSurface: oauthFailure && typeof cloudShareError?.context?.integrationSurface === "string" ? cloudShareError.context.integrationSurface : "cloudshare.v3.authoring_resources", failureMode: cloudShareError ? failureMode(cloudShareError) : "resource_selection", ...(typeof cloudShareError?.context?.status === "number" ? { responseStatus: cloudShareError.context.status } : {}) };
    await deps.diagnostics?.record({ source: "sales-items", operation: "sales.item.authoring_resources.read", outcome: "failure", level: "warn", customerId: request.customerId, actor: request.actor, correlationId, message: "Item resource validation failed", request: typed ? evidence?.request : { method: "GET", path: "/projects" }, response: typed ? evidence?.response : {}, details: diagnostic });
    await audit(deps, request, id ?? "unpersisted", id ? "sales.item.updated" : "sales.item.created", "failure", correlationId, null);
    if (error instanceof ItemValidationError) return response(400, { error: error.message, correlationId });
    if (error instanceof ItemNotFoundError) return response(404, { error: error.message, correlationId });
    return response(typed ? 502 : 400, { error: typed ? "CloudShare resource validation failed. Review support diagnostics." : error instanceof Error ? error.message : "Unable to validate selected CloudShare resources.", correlationId, diagnostic });
  }
}

export async function handleArchiveSalesItem(deps: Pick<SalesItemDeps, "repository" | "diagnostics" | "audit" | "now">, request: { readonly customerId: string; readonly actor?: DiagnosticActor | null; readonly id: string }) { const correlationId = randomUUID(); try { const item = await archiveItem({ repository: deps.repository, now: deps.now }, request); await deps.diagnostics?.record({ source: "sales-items", operation: "sales.item.archived", outcome: "success", customerId: request.customerId, actor: request.actor, subject: { type: "item", id: item.id }, correlationId, message: "Item archived; it remains history-only and cannot start an Enablement Session.", externalIds: { itemId: item.id } }); await audit(deps, request, item.id, "sales.item.archived", "success", correlationId, null); return response(200, { item }); } catch (error) { await audit(deps, request, request.id, "sales.item.archived", "failure", correlationId, null); return response(error instanceof ItemNotFoundError ? 404 : 400, { error: error instanceof Error ? error.message : "Unable to archive Item." }); } }

async function resolveLiveSelections(deps: Pick<SalesItemDeps, "cloudshare" | "diagnostics">, request: SalesItemRequest, connection: NonNullable<Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>>, input: WriteRequest, correlationId: string) {
  const candidate = deps.cloudshare.forConnection(connection) as unknown;
  if (typeof candidate === "object" && candidate !== null && "listProjects" in candidate) return selectFromAuthoringSource(candidate as CloudShareExamAuthoringSource, input);
  const source = createCloudShareSalesItemResourceSource(candidate as Parameters<typeof createCloudShareSalesItemResourceSource>[0]);
  const projects = await source.readProjects(); await record(deps, request, correlationId, projects, "project");
  const regions = await source.readRegions(); await record(deps, request, correlationId, regions, "region");
  const blueprints = await source.readProjectBlueprints(input.projectId); await record(deps, request, correlationId, blueprints, "blueprint");
  const details = await source.readProjectBlueprintDetails(input.projectId, input.blueprintIds); for (const detail of details) await record(deps, request, correlationId, detail, "blueprint_detail");
  let policyRead;
  try { policyRead = await source.readProjectPolicies(input.projectId); } catch (error) { if (error instanceof CloudShareSalesResourceReadError) { for (const read of error.completedReads) await record(deps, request, correlationId, read, "policy"); throw error.cause; } throw error; }
  for (const read of policyRead.reads) await record(deps, request, correlationId, read, "policy");
  return select(projects.data, regions.data, blueprints.data, policyRead.policies, details.map((read) => read.data), input);
}

async function selectFromAuthoringSource(source: CloudShareExamAuthoringSource, input: WriteRequest) { const [projects, regions, blueprints, policies, details] = await Promise.all([source.listProjects(), source.listRegions(), source.listProjectBlueprints(input.projectId), source.listProjectPolicies(input.projectId), Promise.all(input.blueprintIds.map((id) => source.getBlueprintDetail(input.projectId, id)))]); return select(projects, regions, blueprints, policies, details, input); }
function select(projects: Array<{ id: string; name: string }>, regions: Array<{ id: string; name: string; friendlyName?: string }>, blueprints: Array<{ id: string; name: string }>, policies: Array<{ id: string; name: string; storageLeaseMinutes?: number | null }>, details: readonly CloudShareBlueprintDetail[], input: WriteRequest) { const project = projects.find((value) => value.id === input.projectId); const policy = policies.find((value) => value.id === input.policyId); const selectedBlueprints = input.blueprintIds.map((id) => blueprints.find((value) => value.id === id)); if (!project || !policy || selectedBlueprints.some((value) => !value)) throw new ItemValidationError("One or more selected resources are no longer available from the Certalis CloudShare Connection. Refresh and select by name again."); if (!policy.storageLeaseMinutes) throw new ItemValidationError("The selected Policy does not expose a storage lease, so it cannot provide a default Item duration."); const snapshotRegions = details.map((detail) => detail.snapshots.find((snapshot) => snapshot.isDefault)?.regionIds ?? []); const sharedIds = snapshotRegions.reduce((shared, ids) => shared.filter((id) => ids.includes(id))); if (!sharedIds.length) throw new ItemValidationError("The selected Blueprints have no shared default-Snapshot Region. Change the Blueprint steps before saving."); const selectedRegions = input.regionIds.map((id) => regions.find((region) => region.id === id)); if (selectedRegions.some((value) => !value) || input.regionIds.some((id) => !sharedIds.includes(id))) throw new ItemValidationError("Selected Regions must be shared by every selected Blueprint's default Snapshot. Refresh and select only eligible Regions."); return { project, policy: { id: policy.id, name: policy.name }, blueprints: selectedBlueprints as Array<{ id: string; name: string }>, regions: selectedRegions.map((region) => ({ id: region!.id, name: region!.friendlyName ?? region!.name })), defaultDurationMinutes: policy.storageLeaseMinutes }; }
async function record(deps: Pick<SalesItemDeps, "diagnostics">, request: SalesItemRequest, correlationId: string, read: CloudShareDetailedResourceRead<unknown>, resourceType: string) { await deps.diagnostics?.record({ source: "sales-items", operation: "sales.item.authoring_resources.read", outcome: "success", customerId: request.customerId, actor: request.actor, correlationId, message: `${resourceType} resource read succeeded`, request: read.request, response: read.response, details: { integrationSurface: read.integrationSurface }, externalIds: { resourceType } }); }
async function audit(deps: Pick<SalesItemDeps, "audit">, request: { customerId: string; actor?: DiagnosticActor | null }, subjectId: string, action: string, outcome: "success" | "failure", correlationId: string, details: Record<string, unknown> | null) { await deps.audit?.write({ id: randomUUID(), occurredAt: new Date(), customerId: request.customerId, actorType: request.actor?.type ?? null, actorId: request.actor?.id ?? null, actorEmail: request.actor?.email ?? null, action, subjectType: "item", subjectId, outcome, correlationId, details }); }
function failureMode(error: CloudShareError) { return error.name === "CloudShareTransportError" ? "transport" : error.name === "CloudShareResponseError" ? "unexpected_response" : error.name === "CloudShareRateLimitError" ? "rate_limit" : "http_status"; }
