import { z } from "zod";
import type { CloudShareClientFactory, CloudShareConnectionRepository } from "@/domain/cloudshare-connection";
import type { DiagnosticActor, DiagnosticRecorder } from "@/domain/diagnostic-log";
import { archiveDemoItem, createDemoItem, DemoItemNotFoundError, DemoItemValidationError, type DemoItemRepository, updateDemoItem } from "@/domain/demo-item";
import { CloudShareRequestError, CloudShareTransportError } from "@/integrations/cloudshare";
import { createCloudShareExamAuthoringSource, type CloudShareExamAuthoringSource } from "@/integrations/cloudshare/resources";

const writeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(""),
  projectId: z.string().trim().min(1),
  blueprintIds: z.array(z.string().trim().min(1)).min(1),
  policyId: z.string().trim().min(1),
  regionId: z.string().trim().min(1),
  salesExperienceType: z.enum(["guided_demo", "hands_on_demo"]),
});

type WriteRequest = z.infer<typeof writeSchema>;
export interface SalesDemoItemDeps {
  readonly repository: DemoItemRepository;
  readonly connections: Pick<CloudShareConnectionRepository, "findByCustomerId">;
  readonly cloudshare: Pick<CloudShareClientFactory, "forConnection">;
  readonly diagnostics?: DiagnosticRecorder;
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
    const live = await resolveLiveSelections(deps.cloudshare, connection, parsed.data);
    const input = { customerId: request.customerId, name: parsed.data.name, description: parsed.data.description, project: live.project, blueprints: live.blueprints, policy: live.policy, region: live.region, salesExperienceType: parsed.data.salesExperienceType, defaultDurationMinutes: live.defaultDurationMinutes };
    const item = id
      ? await updateDemoItem({ repository: deps.repository, now: deps.now }, { id, ...input })
      : await createDemoItem({ repository: deps.repository, now: deps.now, newId: deps.newId }, input);
    await deps.diagnostics?.record({ source: "sales-demo-items", operation: id ? "sales.demo_item.updated" : "sales.demo_item.created", outcome: "success", customerId: request.customerId, actor: request.actor, subject: { type: "demo_item", id: item.id }, message: `Demo Item ${id ? "updated" : "created"} from live CloudShare resources`, externalIds: { demoItemId: item.id, projectId: item.project.id, policyId: item.policy.id, regionId: item.region.id }, details: { integrationSurface: "cloudshare.v3.authoring_resources", blueprintCount: item.blueprints.length, defaultDurationMinutes: item.defaultDurationMinutes } });
    return response(id ? 200 : 201, { demoItem: item });
  } catch (error) {
    if (error instanceof DemoItemValidationError) return response(400, { error: error.message });
    if (error instanceof DemoItemNotFoundError) return response(404, { error: error.message });
    const status = error instanceof CloudShareRequestError ? 502 : error instanceof CloudShareTransportError ? 502 : 400;
    const diagnostic = { operation: "sales.demo_item.authoring_resources.read", integrationSurface: "cloudshare.v3.authoring_resources", failureMode: error instanceof CloudShareRequestError ? "http_status" : error instanceof CloudShareTransportError ? "transport" : "resource_selection", ...(error instanceof CloudShareRequestError ? { responseStatus: error.status } : {}) };
    await deps.diagnostics?.record({ source: "sales-demo-items", operation: "sales.demo_item.authoring_resources.read", outcome: "failure", level: "warn", customerId: request.customerId, actor: request.actor, message: "Demo Item resource validation failed", details: diagnostic });
    return response(status, { error: error instanceof Error ? error.message : "Unable to validate the selected CloudShare resources.", diagnostic });
  }
}

export async function handleArchiveSalesDemoItem(deps: Pick<SalesDemoItemDeps, "repository" | "diagnostics" | "now">, request: { readonly customerId: string; readonly actor?: DiagnosticActor | null; readonly id: string }) {
  try {
    const item = await archiveDemoItem({ repository: deps.repository, now: deps.now }, request);
    await deps.diagnostics?.record({ source: "sales-demo-items", operation: "sales.demo_item.archived", outcome: "success", customerId: request.customerId, actor: request.actor, subject: { type: "demo_item", id: item.id }, message: "Demo Item archived; it remains history-only and cannot start a Sales Demo Session.", externalIds: { demoItemId: item.id } });
    return response(200, { demoItem: item });
  } catch (error) { return response(error instanceof DemoItemNotFoundError ? 404 : 400, { error: error instanceof Error ? error.message : "Unable to archive Demo Item." }); }
}

async function resolveLiveSelections(factory: CloudShareClientFactory, connection: Exclude<Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>, null>, input: WriteRequest) {
  const candidate = factory.forConnection(connection) as unknown;
  const source: CloudShareExamAuthoringSource = typeof candidate === "object" && candidate !== null && "listProjects" in candidate
    ? candidate as CloudShareExamAuthoringSource
    : createCloudShareExamAuthoringSource(candidate as Parameters<typeof createCloudShareExamAuthoringSource>[0]);
  const [projects, regions, blueprints, policies] = await Promise.all([source.listProjects(), source.listRegions(), source.listProjectBlueprints(input.projectId), source.listProjectPolicies(input.projectId)]);
  const project = projects.find((item) => item.id === input.projectId);
  const region = regions.find((item) => item.id === input.regionId);
  const policy = policies.find((item) => item.id === input.policyId);
  const ordered = input.blueprintIds.map((id) => blueprints.find((blueprint) => blueprint.id === id));
  if (!project || !region || !policy || ordered.some((blueprint) => !blueprint)) throw new DemoItemValidationError("One or more selected resources are no longer available from the Certalis CloudShare Connection. Refresh and select by name again.");
  if (!policy.storageLeaseMinutes) throw new DemoItemValidationError("The selected Policy does not expose a storage lease, so it cannot provide a default Sales Demo duration.");
  return { project, region: { id: region.id, name: region.friendlyName ?? region.name }, policy: { id: policy.id, name: policy.name }, blueprints: ordered as Array<{ id: string; name: string }>, defaultDurationMinutes: policy.storageLeaseMinutes };
}
