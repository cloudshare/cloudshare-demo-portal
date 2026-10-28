import { describe, expect, it, vi } from "vitest";
import { handleArchiveSalesItem, handleCreateSalesItem, handleGetSalesItemBlueprintDetails, handleListSalesItems } from "./sales-items";
import type { Item, ItemRepository } from "@/domain/item";
import type { CloudShareConnectionRecord } from "@/domain/cloudshare-connection";
import { createDiagnosticRecorder } from "@/domain/diagnostic-log";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import { CloudShareAuthError, CloudShareRequestError, CloudShareTransportError } from "@/integrations/cloudshare";
import { CLOUDSHARE_ERROR_DISCRIMINANT } from "@/integrations/cloudshare/errors";

function repository(): ItemRepository { const rows = new Map<string, Item>(); return { save: async (item) => { rows.set(item.id, item); }, findById: async (id) => rows.get(id) ?? null, listByCustomerId: async (customerId) => [...rows.values()].filter((item) => item.customerId === customerId) }; }
const connection: CloudShareConnectionRecord = { customerId: "certalis", apiId: "api-id", apiKey: "api-key", webhookSecret: "secret", webhookPathToken: "token", connectedAt: new Date(), verifiedAt: new Date() };
function source(overrides = {}) { return { listProjects: vi.fn().mockResolvedValue([{ id: "project-1", name: "Certalis Project" }]), listRegions: vi.fn().mockResolvedValue([{ id: "region-1", name: "us-west", friendlyName: "US West" }]), listProjectBlueprints: vi.fn().mockResolvedValue([{ id: "bp-1", name: "Foundation" }, { id: "bp-2", name: "Advanced" }]), listProjectPolicies: vi.fn().mockResolvedValue([{ id: "policy-1", name: "Sales policy", runtimeLeaseMinutes: 60, storageLeaseMinutes: 1440 }]), getBlueprintDetail: vi.fn(async (_projectId: string, id: string) => ({ id, name: id, description: "", defaultSnapshotId: "snapshot-1", snapshots: [{ id: "snapshot-1", name: "Default", isDefault: true, regionIds: ["region-1"] }] })), ...overrides }; }
function deps(repo = repository(), candidate: unknown = source()) { return { repository: repo, connections: { findByCustomerId: vi.fn().mockResolvedValue(connection) }, cloudshare: { forConnection: vi.fn().mockReturnValue(candidate) }, now: () => new Date("2026-07-12T12:00:00Z"), newId: () => "demo-1" }; }
const body = { name: "CX foundation demo", description: "A sales-safe demo", projectId: "project-1", blueprintIds: ["bp-2", "bp-1"], policyId: "policy-1", regionIds: ["region-1"] };

describe("Sales Item API", () => {
  it("creates a Customer-scoped item from live friendly resources and preserves Blueprint order", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    const result = await handleCreateSalesItem({ ...deps(), diagnostics: createDiagnosticRecorder({ repository: diagnostics }) }, { customerId: "certalis", body });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ item: { customerId: "certalis", blueprints: [{ name: "Advanced" }, { name: "Foundation" }], policy: { name: "Sales policy" }, regions: [{ name: "US West" }], defaultDurationMinutes: 1440 } });
    expect(await diagnostics.query({ operation: "sales.item.created" })).toHaveLength(1);
  });

  it("rejects duplicate Blueprint choices before any persisted Item", async () => {
    const repo = repository();
    const result = await handleCreateSalesItem(deps(repo), { customerId: "certalis", body: { ...body, blueprintIds: ["bp-1", "bp-1"] } });
    expect(result.status).toBe(400);
    await expect(handleListSalesItems({ repository: repo }, { customerId: "certalis" })).resolves.toMatchObject({ body: { activeItems: [] } });
  });

  it("rejects a stale Region outside the shared default-Snapshot intersection without persisting an Item", async () => {
    const repo = repository(); const diagnostics = createInMemoryDiagnosticLogRepository();
    const candidate = source({ listRegions: vi.fn().mockResolvedValue([{ id: "region-1", name: "us-west" }, { id: "region-2", name: "us-east" }]), getBlueprintDetail: vi.fn(async (_projectId: string, id: string) => ({ id, name: id, description: "", defaultSnapshotId: "snapshot-1", snapshots: [{ id: "snapshot-1", name: "Default", isDefault: true, regionIds: id === "bp-1" ? ["region-1", "region-2"] : ["region-1"] }] })) });
    const result = await handleCreateSalesItem({ ...deps(repo, candidate), diagnostics: createDiagnosticRecorder({ repository: diagnostics }) }, { customerId: "certalis", body: { ...body, blueprintIds: ["bp-1", "bp-2"], regionIds: ["region-2"] } });
    expect(result).toMatchObject({ status: 400, body: { error: expect.stringContaining("Selected Regions must be shared by every selected Blueprint's default Snapshot.") } });
    await expect(handleListSalesItems({ repository: repo }, { customerId: "certalis" })).resolves.toMatchObject({ body: { activeItems: [] } });
    expect(await diagnostics.query({ source: "sales-items", operation: "sales.item.authoring_resources.read", outcome: "failure" })).toHaveLength(1);
  });

  it("rejects Blueprint steps with no shared default-Snapshot Region without persisting an Item", async () => {
    const repo = repository(); const diagnostics = createInMemoryDiagnosticLogRepository();
    const candidate = source({ getBlueprintDetail: vi.fn(async (_projectId: string, id: string) => ({ id, name: id, description: "", defaultSnapshotId: "snapshot-1", snapshots: [{ id: "snapshot-1", name: "Default", isDefault: true, regionIds: id === "bp-1" ? ["region-1"] : ["region-2"] }] })) });
    const result = await handleCreateSalesItem({ ...deps(repo, candidate), diagnostics: createDiagnosticRecorder({ repository: diagnostics }) }, { customerId: "certalis", body: { ...body, blueprintIds: ["bp-1", "bp-2"], regionIds: ["region-1"] } });
    expect(result).toMatchObject({ status: 400, body: { error: expect.stringContaining("The selected Blueprints have no shared default-Snapshot Region.") } });
    await expect(handleListSalesItems({ repository: repo }, { customerId: "certalis" })).resolves.toMatchObject({ body: { activeItems: [] } });
    expect(await diagnostics.query({ source: "sales-items", operation: "sales.item.authoring_resources.read", outcome: "failure" })).toHaveLength(1);
  });

  it("records redacted success evidence for live Blueprint-detail reads", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    const client = { requestV3Detailed: vi.fn(async (spec: { path: string; method: string; schema: { parse(value: unknown): unknown } }) => { const payload = { id: "bp-1", name: "Foundation", createFromVersions: [{ id: "snapshot-1", name: "Default", isDefault: true, regions: ["region-1"] }] }; return { data: spec.schema.parse(payload), request: { method: spec.method, path: spec.path, headers: { authorization: "api-key" } }, response: { status: 200, headers: { "x-request-id": "req-1" }, body: payload } }; }) };
    const result = await handleGetSalesItemBlueprintDetails({ connections: { findByCustomerId: vi.fn().mockResolvedValue(connection) }, cloudshare: { forConnection: vi.fn().mockReturnValue(client) }, diagnostics: createDiagnosticRecorder({ repository: diagnostics, secrets: ["api-key"] }) }, { customerId: "certalis", projectId: "project-1", blueprintIds: ["bp-1"] });
    expect(result).toMatchObject({ status: 200, body: { blueprintDetails: [{ id: "bp-1", defaultSnapshotRegionIds: ["region-1"] }] } });
    const [entry] = await diagnostics.query({ source: "sales-items", operation: "sales.item.authoring_resources.read", outcome: "success" });
    expect(entry).toMatchObject({ request: { path: "/projects/project-1/blueprints/bp-1", headers: { authorization: "[REDACTED]" } }, response: { status: 200 }, details: { integrationSurface: "cloudshare.v3.projects.blueprint_detail" } });
  });

  it("records redacted failure evidence when a live Blueprint-detail read fails", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    const client = { requestV3Detailed: vi.fn(async (spec: { path: string }) => { throw new CloudShareRequestError("forbidden api-key", 403, { method: "GET", path: spec.path, requestHeaders: { authorization: "api-key" }, responseHeaders: { "x-request-id": "req-1" }, responseBody: "{\\\"error\\\":\\\"forbidden\\\"}" }); }) };
    const result = await handleGetSalesItemBlueprintDetails({ connections: { findByCustomerId: vi.fn().mockResolvedValue(connection) }, cloudshare: { forConnection: vi.fn().mockReturnValue(client) }, diagnostics: createDiagnosticRecorder({ repository: diagnostics, secrets: ["api-key"] }) }, { customerId: "certalis", projectId: "project-1", blueprintIds: ["bp-1"] });
    expect(result).toMatchObject({ status: 502, body: { error: "CloudShare Blueprint detail validation failed. Review support diagnostics.", diagnostic: { integrationSurface: "cloudshare.v3.projects.blueprint_detail", responseStatus: 403 } } });
    const [entry] = await diagnostics.query({ source: "sales-items", operation: "sales.item.authoring_resources.read", outcome: "failure" });
    expect(entry).toMatchObject({ request: { path: "/projects/project-1/blueprints/bp-1", headers: { authorization: "[REDACTED]" } }, response: { status: 403, headers: { "x-request-id": "req-1" } }, details: { integrationSurface: "cloudshare.v3.projects.blueprint_detail" } });
    expect(JSON.stringify(entry)).not.toContain("api-key");
  });

  it("records a redacted support diagnostic when live authoring resources fail", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    const result = await handleCreateSalesItem({ ...deps(repository(), source({ listProjects: vi.fn().mockRejectedValue(new CloudShareRequestError("forbidden api-key", 403, { method: "GET", path: "/projects?include=active", requestHeaders: { authorization: "api-key" }, responseHeaders: { "x-request-id": "req-1" }, responseBody: "{\"error\":\"forbidden\"}" })) })), diagnostics: createDiagnosticRecorder({ repository: diagnostics, secrets: ["api-key"] }) }, { customerId: "certalis", body });
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ diagnostic: { integrationSurface: "cloudshare.authoring_resources", failureMode: "http_status", responseStatus: 403 } });
    const [entry] = await diagnostics.query({ customerId: "certalis" });
    expect(entry.message).not.toContain("api-key");
    expect(entry).toMatchObject({ request: { method: "GET", path: "/projects?include=active", headers: { authorization: "[REDACTED]" } }, response: { status: 403, headers: { "x-request-id": "req-1" }, body: "{\"error\":\"forbidden\"}" } });
  });

  it("retains a redacted transport cause in diagnostic evidence without exposing it to the API response", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    const result = await handleCreateSalesItem({ ...deps(repository(), source({ listProjects: vi.fn().mockRejectedValue(new CloudShareTransportError("tls handshake failed", { method: "GET", path: "/projects", cause: { code: "CERT_UNTRUSTED", message: "certificate rejected" }, network: { code: "ECONNRESET", host: "api.cloudshare.example" }, tls: { protocol: "TLSv1.3", authorization: "api-key" } })) })), diagnostics: createDiagnosticRecorder({ repository: diagnostics, secrets: ["api-key"] }) }, { customerId: "certalis", body });
    expect(result).toMatchObject({ status: 502, body: { error: "CloudShare resource validation failed. Review support diagnostics." } });
    const [entry] = await diagnostics.query({ customerId: "certalis" });
    expect(entry.response).toMatchObject({ cause: { code: "CERT_UNTRUSTED", message: "certificate rejected" }, network: { code: "ECONNRESET", host: "api.cloudshare.example" }, tls: { protocol: "TLSv1.3", authorization: "api-key" } });
  });

  it("keeps OAuth token failure evidence metadata-only during Item authoring resource reads", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    const oauthFailure = new CloudShareAuthError("OAuth token exchange returned 503", { method: "POST", path: "/oauth/token", integrationSurface: "cloudshare.v4.oauth.token", status: 503, requestBody: { client_secret: "private-secret" }, responseBody: { access_token: "private-token" } });
    const result = await handleCreateSalesItem({ ...deps(repository(), source({ listProjects: vi.fn().mockRejectedValue(oauthFailure) })), diagnostics: createDiagnosticRecorder({ repository: diagnostics }) }, { customerId: "certalis", body });
    const [failure] = await diagnostics.query({ operation: "sales.item.authoring_resources.read", outcome: "failure" });

    expect(result).toMatchObject({ status: 502, body: { correlationId: expect.any(String) } });
    expect(failure).toMatchObject({ request: null, response: null, details: expect.objectContaining({ integrationSurface: "cloudshare.v4.oauth.token", responseStatus: 503 }) });
    expect(JSON.stringify(failure)).not.toMatch(/private-secret|private-token/);
  });

  it("classifies branded CloudShare failures across module boundaries", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    const brandedFailure = Object.assign(new Error("reloaded provider failure"), {
      name: "CloudShareRequestError",
      cloudShareErrorBoundaryDiscriminant: CLOUDSHARE_ERROR_DISCRIMINANT,
      status: 503,
      context: {
        method: "GET",
        path: "/projects",
        integrationSurface: "cloudshare.v4.projects",
        status: 503,
        responseBody: { error: "unavailable" },
      },
    });
    const result = await handleCreateSalesItem({ ...deps(repository(), source({ listProjects: vi.fn().mockRejectedValue(brandedFailure) })), diagnostics: createDiagnosticRecorder({ repository: diagnostics }) }, { customerId: "certalis", body });
    const [failure] = await diagnostics.query({ operation: "sales.item.authoring_resources.read", outcome: "failure" });

    expect(result).toMatchObject({ status: 502, body: { diagnostic: { integrationSurface: "cloudshare.v4.projects", failureMode: "http_status", responseStatus: 503 } } });
    expect(failure).toMatchObject({
      request: expect.objectContaining({ method: "GET", path: "/projects" }),
      response: expect.objectContaining({ status: 503, body: { error: "unavailable" } }),
      details: expect.objectContaining({ integrationSurface: "cloudshare.v4.projects", failureMode: "http_status", responseStatus: 503 }),
    });
  });

  it("persists completed policy exchanges before a sibling policy detail failure", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    const client = { requestV3Detailed: vi.fn(async (spec: { path: string; method: string; schema: { parse(value: unknown): unknown } }) => {
      const values: Record<string, unknown> = { "/projects": { count: 1, items: [{ id: "project-1", name: "Certalis Project" }] }, "/regions": [{ id: "region-1", name: "us-west" }], "/projects/project-1/blueprints": [{ id: "bp-1", name: "Foundation" }], "/projects/project-1/blueprints/bp-1": { id: "bp-1", name: "Foundation", createFromVersions: [{ id: "snapshot-1", name: "Default", isDefault: true, regions: ["region-1"] }] }, "/projects/project-1/policies": { count: 2, items: [{ projectId: "project-1", id: "policy-1", name: "One" }, { projectId: "project-1", id: "policy-2", name: "Two" }] }, "/projects/project-1/policies/policy-1": { projectId: "project-1", id: "policy-1", name: "One", storageMinutes: 60 } };
      if (spec.path.endsWith("policy-2")) throw new CloudShareRequestError("forbidden", 403, { method: "GET", path: spec.path, responseBody: "{\"error\":\"forbidden\"}" });
      const value = spec.schema.parse(values[spec.path]); return { data: value, request: { method: spec.method, path: spec.path }, response: { status: 200, body: values[spec.path] } };
    }) };
    Object.assign(client, { requestV4Detailed: client.requestV3Detailed });
    const result = await handleCreateSalesItem({ ...deps(repository(), client), diagnostics: createDiagnosticRecorder({ repository: diagnostics }) }, { customerId: "certalis", body: { ...body, blueprintIds: ["bp-1"], policyId: "policy-1" } });
    expect(result.status).toBe(502);
    const reads = await diagnostics.query({ operation: "sales.item.authoring_resources.read", outcome: "success" });
    expect(reads.map((entry) => entry.request?.path)).toEqual(expect.arrayContaining(["/projects/project-1/policies", "/projects/project-1/policies/policy-1"]));
  });

  it("keeps archived items in history and does not return them as active", async () => {
    const repo = repository(); const created = await handleCreateSalesItem(deps(repo), { customerId: "certalis", body });
    const id = (created.body.item as Item).id;
    await expect(handleArchiveSalesItem({ repository: repo }, { customerId: "certalis", id })).resolves.toMatchObject({ status: 200 });
    await expect(handleListSalesItems({ repository: repo }, { customerId: "certalis" })).resolves.toMatchObject({ body: { activeItems: [], archivedItems: [{ id, status: "archived" }] } });
  });

  it("writes Customer-scoped append-only audit evidence for create and archive mutations", async () => {
    const repo = repository(); const audit = { write: vi.fn().mockResolvedValue(undefined) };
    const created = await handleCreateSalesItem({ ...deps(repo), audit }, { customerId: "certalis", actor: { type: "admin", id: "sales-admin", email: "sales@certalis.demo" }, body });
    const id = (created.body.item as Item).id;
    await handleArchiveSalesItem({ repository: repo, audit }, { customerId: "certalis", actor: { type: "admin", id: "sales-admin", email: "sales@certalis.demo" }, id });
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ customerId: "certalis", action: "sales.item.created", subjectId: id, outcome: "success" }));
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ customerId: "certalis", action: "sales.item.archived", subjectId: id, outcome: "success" }));
  });
});
