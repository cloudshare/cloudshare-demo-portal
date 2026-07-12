import { describe, expect, it, vi } from "vitest";
import { handleArchiveSalesDemoItem, handleCreateSalesDemoItem, handleListSalesDemoItems } from "./sales-demo-items";
import type { DemoItem, DemoItemRepository } from "@/domain/demo-item";
import type { CloudShareConnectionRecord } from "@/domain/cloudshare-connection";
import { createDiagnosticRecorder } from "@/domain/diagnostic-log";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import { CloudShareRequestError, CloudShareTransportError } from "@/integrations/cloudshare";

function repository(): DemoItemRepository { const rows = new Map<string, DemoItem>(); return { save: async (item) => { rows.set(item.id, item); }, findById: async (id) => rows.get(id) ?? null, listByCustomerId: async (customerId) => [...rows.values()].filter((item) => item.customerId === customerId) }; }
const connection: CloudShareConnectionRecord = { customerId: "certalis", apiId: "api-id", apiKey: "api-key", webhookSecret: "secret", webhookPathToken: "token", connectedAt: new Date(), verifiedAt: new Date() };
function source(overrides = {}) { return { listProjects: vi.fn().mockResolvedValue([{ id: "project-1", name: "Certalis Project" }]), listRegions: vi.fn().mockResolvedValue([{ id: "region-1", name: "us-west", friendlyName: "US West" }]), listProjectBlueprints: vi.fn().mockResolvedValue([{ id: "bp-1", name: "Foundation" }, { id: "bp-2", name: "Advanced" }]), listProjectPolicies: vi.fn().mockResolvedValue([{ id: "policy-1", name: "Sales policy", runtimeLeaseMinutes: 60, storageLeaseMinutes: 1440 }]), getBlueprintDetail: vi.fn(), ...overrides }; }
function deps(repo = repository(), candidate = source()) { return { repository: repo, connections: { findByCustomerId: vi.fn().mockResolvedValue(connection) }, cloudshare: { forConnection: vi.fn().mockReturnValue(candidate) }, now: () => new Date("2026-07-12T12:00:00Z"), newId: () => "demo-1" }; }
const body = { name: "CX foundation demo", description: "A sales-safe demo", projectId: "project-1", blueprintIds: ["bp-2", "bp-1"], policyId: "policy-1", regionId: "region-1", salesExperienceType: "demo" };

describe("Sales Demo Item API", () => {
  it("creates a Customer-scoped item from live friendly resources and preserves Blueprint order", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    const result = await handleCreateSalesDemoItem({ ...deps(), diagnostics: createDiagnosticRecorder({ repository: diagnostics }) }, { customerId: "certalis", body });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ demoItem: { customerId: "certalis", blueprints: [{ name: "Advanced" }, { name: "Foundation" }], policy: { name: "Sales policy" }, region: { name: "US West" }, defaultDurationMinutes: 1440 } });
    const reads = await diagnostics.query({ operation: "sales.demo_item.authoring_resources.read" });
    expect(reads).toHaveLength(4);
    expect(reads).toEqual(expect.arrayContaining([expect.objectContaining({ request: expect.objectContaining({ method: "GET", path: "/projects" }), response: expect.objectContaining({ status: 200, body: expect.any(Object) }) }), expect.objectContaining({ request: expect.objectContaining({ method: "GET", path: "/regions" }), response: expect.objectContaining({ status: 200, body: expect.any(Object) }) }), expect.objectContaining({ request: expect.objectContaining({ method: "GET", path: "/projects/project-1/blueprints" }), response: expect.objectContaining({ status: 200, body: expect.any(Object) }) }), expect.objectContaining({ request: expect.objectContaining({ method: "GET", path: "/projects/project-1/policies" }), response: expect.objectContaining({ status: 200, body: expect.any(Object) }) })]));
  });

  it("rejects duplicate Blueprint choices before any persisted Sales Demo Item", async () => {
    const repo = repository();
    const result = await handleCreateSalesDemoItem(deps(repo), { customerId: "certalis", body: { ...body, blueprintIds: ["bp-1", "bp-1"] } });
    expect(result.status).toBe(400);
    await expect(handleListSalesDemoItems({ repository: repo }, { customerId: "certalis" })).resolves.toMatchObject({ body: { activeDemoItems: [] } });
  });

  it("records a redacted support diagnostic when live authoring resources fail", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    const result = await handleCreateSalesDemoItem({ ...deps(repository(), source({ listProjects: vi.fn().mockRejectedValue(new CloudShareRequestError("forbidden api-key", 403, { method: "GET", path: "/projects?include=active", requestHeaders: { authorization: "api-key" }, responseHeaders: { "x-request-id": "req-1" }, responseBody: "{\"error\":\"forbidden\"}" })) })), diagnostics: createDiagnosticRecorder({ repository: diagnostics, secrets: ["api-key"] }) }, { customerId: "certalis", body });
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ diagnostic: { integrationSurface: "cloudshare.v3.authoring_resources", failureMode: "http_status", responseStatus: 403 } });
    const [entry] = await diagnostics.query({ customerId: "certalis" });
    expect(entry.message).not.toContain("api-key");
    expect(entry).toMatchObject({ request: { method: "GET", path: "/projects?include=active", headers: { authorization: "[REDACTED]" } }, response: { status: 403, headers: { "x-request-id": "req-1" }, body: "{\"error\":\"forbidden\"}" } });
  });

  it("retains a redacted transport cause in diagnostic evidence without exposing it to the API response", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    const result = await handleCreateSalesDemoItem({ ...deps(repository(), source({ listProjects: vi.fn().mockRejectedValue(new CloudShareTransportError("tls handshake failed", { method: "GET", path: "/projects", cause: { code: "CERT_UNTRUSTED", message: "certificate rejected" } })) })), diagnostics: createDiagnosticRecorder({ repository: diagnostics }) }, { customerId: "certalis", body });
    expect(result).toMatchObject({ status: 502, body: { error: "CloudShare resource validation failed. Review support diagnostics." } });
    const [entry] = await diagnostics.query({ customerId: "certalis" });
    expect(entry.response).toMatchObject({ cause: { code: "CERT_UNTRUSTED", message: "certificate rejected" } });
  });

  it("keeps archived items in history and does not return them as active", async () => {
    const repo = repository(); const created = await handleCreateSalesDemoItem(deps(repo), { customerId: "certalis", body });
    const id = (created.body.demoItem as DemoItem).id;
    await expect(handleArchiveSalesDemoItem({ repository: repo }, { customerId: "certalis", id })).resolves.toMatchObject({ status: 200 });
    await expect(handleListSalesDemoItems({ repository: repo }, { customerId: "certalis" })).resolves.toMatchObject({ body: { activeDemoItems: [], archivedDemoItems: [{ id, status: "archived" }] } });
  });

  it("writes Customer-scoped append-only audit evidence for create and archive mutations", async () => {
    const repo = repository(); const audit = { write: vi.fn().mockResolvedValue(undefined) };
    const created = await handleCreateSalesDemoItem({ ...deps(repo), audit }, { customerId: "certalis", actor: { type: "admin", id: "sales-admin", email: "sales@certalis.demo" }, body });
    const id = (created.body.demoItem as DemoItem).id;
    await handleArchiveSalesDemoItem({ repository: repo, audit }, { customerId: "certalis", actor: { type: "admin", id: "sales-admin", email: "sales@certalis.demo" }, id });
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ customerId: "certalis", action: "sales.demo_item.created", subjectId: id, outcome: "success" }));
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ customerId: "certalis", action: "sales.demo_item.archived", subjectId: id, outcome: "success" }));
  });
});

