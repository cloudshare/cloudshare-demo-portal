import { describe, expect, it, vi } from "vitest";
import { handleCreateSalesDemoSession } from "./sales-demo-sessions";
import { createInMemorySalesRecordRepository } from "@/domain/sales-records";
import { CloudShareRequestError } from "@/integrations/cloudshare/errors";
import { SalesItemProvisioningReadError } from "@/integrations/cloudshare/sales-item-provisioning";

const admin = { type: "admin", id: "sales-admin", email: "sales-admin@certalis.demo" };
const projectMembers = {
  listActiveProjectMembers: vi.fn().mockResolvedValue({
    members: [{ email: admin.email, displayName: "Sales Admin" }],
    request: { method: "GET", path: "/users", query: { projectUsers: "true", status: "active", projectId: "project-1", getRows: "true" } },
    response: { status: 200, body: { Rows: [] } }, integrationSurface: "cloudshare.v3.project_members_gui",
  }),
};

describe("Sales Enablement Session API handler", () => {
  it("creates one Customer-scoped registered-only Sales Experience and records correlated evidence", async () => {
    const records = createInMemorySalesRecordRepository();
    await records.saveOpportunity({ id: "opp-1", customerId: "certalis", accountId: "account-1", name: "Acme evaluation", status: "open", archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const items = { findById: vi.fn().mockResolvedValue({ id: "item-1", customerId: "certalis", name: "Accelerate Demo", description: "", project: { id: "project-1", name: "Certalis project" }, blueprints: [{ id: "bp-1", name: "Foundation" }], policy: { id: "policy-1", name: "Sales policy" }, regions: [{ id: "region-1", name: "US West" }], salesExperienceType: "demo", defaultDurationMinutes: 1440, status: "active" }) };
    const sessions = { save: vi.fn(), listByOpportunity: vi.fn().mockResolvedValue([]) };
    const delivery = { createSession: vi.fn().mockResolvedValue({ salesExperienceId: "sales-1", request: { method: "POST", path: "/sales", body: {} }, response: { status: 201, body: { id: "sales-1" } } }) };
    const diagnostics = { record: vi.fn().mockResolvedValue(undefined) };
    const audit = { write: vi.fn().mockResolvedValue(undefined) };
    const itemProvisioningValidator = { revalidate: vi.fn().mockResolvedValue([{ request: { method: "GET", path: "/projects/project-1/blueprints" }, response: { status: 200 }, integrationSurface: "cloudshare.v3.projects.blueprints" }]) };

    const result = await handleCreateSalesDemoSession({ records, items, sessions, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, deliveryFactory: { forConnection: vi.fn().mockReturnValue(delivery) }, projectMembers, itemProvisioningValidator, diagnostics, audit, now: () => new Date("2026-07-14T15:00:00.000Z"), newId: () => "session-1" }, { customerId: "certalis", actor: admin, body: { opportunityId: "opp-1", itemId: "item-1", salesProEmail: admin.email, start: "2026-07-15T09:00", end: "2026-07-16T09:00", timeZone: "Mountain Standard Time", type: "poc" } });

    expect(result).toMatchObject({ status: 201, body: { session: { id: "session-1", opportunityId: "opp-1", itemId: "item-1", salesProDisplayName: "Sales Admin" } } });
    expect(JSON.stringify(result.body)).not.toContain("cloudShareSalesExperienceId");
    expect(JSON.stringify(result.body)).not.toContain("sales-1");
    expect(delivery.createSession).toHaveBeenCalledWith(expect.objectContaining({ name: "Accelerate Demo — Acme evaluation — session1", opportunity: "Acme evaluation", externalId: "session1", passphrase: expect.stringMatching(/^[A-Za-z0-9]{32}$/), registrationType: "registeredParticipantsOnly", sendInvitations: "dontSend", mainSalesProEmail: admin.email, type: "poc" }));
    expect(sessions.save).toHaveBeenCalledWith(expect.objectContaining({ opportunityId: "opp-1", itemId: "item-1" }));
    expect(itemProvisioningValidator.revalidate).toHaveBeenCalledWith(expect.objectContaining({ id: "item-1" }));
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: "sales.demo_session.created", correlationId: expect.any(String), outcome: "success" }));
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ operation: "sales.demo_session.created", details: expect.objectContaining({ integrationSurface: "cloudshare.v4.sales", registrationType: "registeredParticipantsOnly" }) }));

    await handleCreateSalesDemoSession({ records, items, sessions, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, deliveryFactory: { forConnection: vi.fn().mockReturnValue(delivery) }, projectMembers, itemProvisioningValidator, diagnostics, audit, now: () => new Date("2026-07-14T15:00:00.000Z"), newId: () => "session-2" }, { customerId: "certalis", actor: admin, body: { opportunityId: "opp-1", itemId: "item-1", salesProEmail: admin.email, start: "2026-07-16T09:00", end: "2026-07-17T09:00", timeZone: "Mountain Standard Time", type: "poc" } });

    const [first, second] = delivery.createSession.mock.calls.map(([input]) => input);
    expect(first.name).not.toBe(second.name);
    expect(first.name).toMatch(/session1$/);
    expect(second.name).toMatch(/session2$/);
    expect(first.name.length).toBeLessThanOrEqual(100);
    expect(second.name.length).toBeLessThanOrEqual(100);
  });

  it("surfaces CloudShare main Sales Pro validation from the atomic create request with supportable evidence", async () => {
    const records = createInMemorySalesRecordRepository();
    await records.saveOpportunity({ id: "opp-1", customerId: "certalis", accountId: "account-1", name: "Acme evaluation", status: "open", archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const delivery = { createSession: vi.fn().mockRejectedValue(new Error("not a Project Sales Pro")) };
    const diagnostics = { record: vi.fn().mockResolvedValue(undefined) };
    const result = await handleCreateSalesDemoSession({ records, items: { findById: vi.fn().mockResolvedValue({ id: "item-1", customerId: "certalis", name: "Demo", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" }) }, sessions: { save: vi.fn(), listByOpportunity: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, deliveryFactory: { forConnection: vi.fn().mockReturnValue(delivery) }, projectMembers, diagnostics, audit: { write: vi.fn().mockRejectedValue(new Error("audit unavailable")) }, newId: () => "session-1" }, { customerId: "certalis", actor: admin, body: { opportunityId: "opp-1", itemId: "item-1", salesProEmail: admin.email, start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "Mountain Standard Time" } });
    expect(result).toMatchObject({ status: 422, body: { correlationId: expect.any(String) } });
    expect(delivery.createSession).toHaveBeenCalledOnce();
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure", details: expect.objectContaining({ failureMode: "main_sales_pro_validation" }) }));
  });

  it("preserves a CloudShare validation response when failure evidence stores are unavailable", async () => {
    const records = createInMemorySalesRecordRepository();
    await records.saveOpportunity({ id: "opp-1", customerId: "certalis", accountId: "account-1", name: "Acme", status: "open", archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const item = { id: "item-1", customerId: "certalis", name: "Demo", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" };
    const result = await handleCreateSalesDemoSession({ records, items: { findById: vi.fn().mockResolvedValue(item) }, sessions: { save: vi.fn(), listByOpportunity: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, deliveryFactory: { forConnection: vi.fn().mockReturnValue({ createSession: vi.fn().mockRejectedValue(new Error("not a Project Sales Pro")) }) }, projectMembers, diagnostics: { record: vi.fn().mockRejectedValue(new Error("diagnostics unavailable")) }, audit: { write: vi.fn().mockRejectedValue(new Error("audit unavailable")) } }, { customerId: "certalis", actor: admin, body: { opportunityId: "opp-1", itemId: "item-1", salesProEmail: admin.email, start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC" } });

    expect(result).toMatchObject({ status: 422, body: { error: "CloudShare rejected the selected Sales Pro. Review support diagnostics.", correlationId: expect.any(String) } });
  });

  it("denies cross-Customer Opportunity selection with correlated audit and diagnostic evidence", async () => {
    const records = createInMemorySalesRecordRepository();
    await records.saveOpportunity({ id: "opp-other", customerId: "helios", accountId: "account-1", name: "Other", status: "open", archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const diagnostics = { record: vi.fn().mockResolvedValue(undefined) }; const audit = { write: vi.fn().mockRejectedValue(new Error("audit unavailable")) };
    const result = await handleCreateSalesDemoSession({ records, items: { findById: vi.fn() }, sessions: { save: vi.fn(), listByOpportunity: vi.fn() }, connections: { findByCustomerId: vi.fn() }, diagnostics, audit }, { customerId: "certalis", actor: admin, body: { opportunityId: "opp-other", itemId: "item-1", salesProEmail: admin.email, start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC" } });
    expect(result).toMatchObject({ status: 404, body: { correlationId: expect.any(String) } });
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ source: "sales-demo-sessions", request: { method: "POST", path: "/api/sales/demo-sessions" }, response: { status: 404 }, details: expect.objectContaining({ failureMode: "opportunity_not_found" }) }));
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ outcome: "denied", correlationId: expect.any(String) }));
  });

  it("returns needs-attention without a CloudShare ID when local correlation persistence fails", async () => {
    const records = createInMemorySalesRecordRepository(); await records.saveOpportunity({ id: "opp-1", customerId: "certalis", accountId: "account-1", name: "Acme", status: "open", archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const result = await handleCreateSalesDemoSession({ records, items: { findById: vi.fn().mockResolvedValue({ id: "item-1", customerId: "certalis", name: "Demo", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" }) }, sessions: { save: vi.fn().mockRejectedValue(new Error("database unavailable")), listByOpportunity: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, deliveryFactory: { forConnection: vi.fn().mockReturnValue({ createSession: vi.fn().mockResolvedValue({ salesExperienceId: "sales-created", request: { method: "POST", path: "/sales", body: {} }, response: { status: 201, body: { id: "sales-created" } } }) }) }, projectMembers, diagnostics: { record: vi.fn() }, audit: { write: vi.fn() } }, { customerId: "certalis", actor: admin, body: { opportunityId: "opp-1", itemId: "item-1", salesProEmail: admin.email, start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC" } });
    expect(result).toMatchObject({ status: 503, body: { needsAttention: true, correlationId: expect.any(String) } });
    expect(JSON.stringify(result.body)).not.toContain("sales-created");
  });

  it("keeps the remote ID server-side even if secondary diagnostic and audit writes fail", async () => {
    const records = createInMemorySalesRecordRepository(); await records.saveOpportunity({ id: "opp-1", customerId: "certalis", accountId: "account-1", name: "Acme", status: "open", archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const item = { id: "item-1", customerId: "certalis", name: "Demo", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" };
    const result = await handleCreateSalesDemoSession({ records, items: { findById: vi.fn().mockResolvedValue(item) }, sessions: { save: vi.fn().mockRejectedValue(new Error("database unavailable")), listByOpportunity: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, deliveryFactory: { forConnection: vi.fn().mockReturnValue({ createSession: vi.fn().mockResolvedValue({ salesExperienceId: "sales-created", request: { method: "POST", path: "/sales", body: {} }, response: { status: 201, body: { id: "sales-created" } } }) }) }, projectMembers, diagnostics: { record: vi.fn().mockRejectedValue(new Error("diagnostic unavailable")) }, audit: { write: vi.fn().mockRejectedValue(new Error("audit unavailable")) } }, { customerId: "certalis", actor: admin, body: { opportunityId: "opp-1", itemId: "item-1", salesProEmail: admin.email, start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC" } });
    expect(result).toMatchObject({ status: 503, body: { needsAttention: true, correlationId: expect.any(String) } });
    expect(JSON.stringify(result.body)).not.toContain("sales-created");
  });

  it("preserves the completed v3 reads and typed failure exchange when Item revalidation cannot finish", async () => {
    const records = createInMemorySalesRecordRepository(); await records.saveOpportunity({ id: "opp-1", customerId: "certalis", accountId: "account-1", name: "Acme", status: "open", archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const diagnostics = { record: vi.fn().mockResolvedValue(undefined) };
    const cause = new CloudShareRequestError("CloudShare timed out", 504, { method: "GET", path: "/projects/project-1/policies", requestQuery: { page: "1" }, requestHeaders: { "x-request-id": "req-v3" }, responseHeaders: { "x-cloud": "slow" }, responseBody: { error: "timeout" }, network: { remoteAddress: "203.0.113.9" }, tls: { protocol: "TLSv1.3" } });
    const revalidate = vi.fn().mockRejectedValue(new SalesItemProvisioningReadError("Could not read Item", [{ data: {}, request: { method: "GET", path: "/projects/project-1/blueprints" }, response: { status: 200 }, integrationSurface: "cloudshare.v3.projects.blueprints" }], cause));
    const result = await handleCreateSalesDemoSession({ records, items: { findById: vi.fn().mockResolvedValue({ id: "item-1", customerId: "certalis", name: "Demo", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" }) }, sessions: { save: vi.fn(), listByOpportunity: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, deliveryFactory: { forConnection: vi.fn().mockReturnValue({ createSession: vi.fn() }) }, projectMembers, itemProvisioningValidator: { revalidate }, diagnostics, audit: { write: vi.fn() } }, { customerId: "certalis", actor: admin, body: { opportunityId: "opp-1", itemId: "item-1", salesProEmail: admin.email, start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC" } });
    expect(result).toMatchObject({ status: 502, body: { correlationId: expect.any(String) } });
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ operation: "sales.enablement_session.item_resources.revalidated", outcome: "failure", details: expect.objectContaining({ integrationSurface: "cloudshare.v3.projects.blueprints" }) }));
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ operation: "sales.demo_session.created", details: expect.objectContaining({ integrationSurface: "cloudshare.v3.sales_item_resources", failureMode: "item_resource_read" }), request: expect.objectContaining({ query: { page: "1" }, headers: { "x-request-id": "req-v3" } }), response: expect.objectContaining({ status: 504, headers: { "x-cloud": "slow" }, network: { remoteAddress: "203.0.113.9" }, tls: { protocol: "TLSv1.3" } }) }));
  });

  it("preserves the item-resource failure response when diagnostics cannot record completed reads", async () => {
    const records = createInMemorySalesRecordRepository();
    await records.saveOpportunity({ id: "opp-1", customerId: "certalis", accountId: "account-1", name: "Acme", status: "open", archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const item = { id: "item-1", customerId: "certalis", name: "Demo", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" };
    const cause = new CloudShareRequestError("CloudShare timed out", 504, { method: "GET", path: "/projects/project-1/policies" });
    const revalidate = vi.fn().mockRejectedValue(new SalesItemProvisioningReadError("Could not read Item", [{ data: {}, request: { method: "GET", path: "/projects/project-1/blueprints" }, response: { status: 200 }, integrationSurface: "cloudshare.v3.projects.blueprints" }], cause));
    const result = await handleCreateSalesDemoSession({ records, items: { findById: vi.fn().mockResolvedValue(item) }, sessions: { save: vi.fn(), listByOpportunity: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, deliveryFactory: { forConnection: vi.fn().mockReturnValue({ createSession: vi.fn() }) }, projectMembers, itemProvisioningValidator: { revalidate }, diagnostics: { record: vi.fn().mockRejectedValue(new Error("diagnostics unavailable")) }, audit: { write: vi.fn().mockRejectedValue(new Error("audit unavailable")) } }, { customerId: "certalis", actor: admin, body: { opportunityId: "opp-1", itemId: "item-1", salesProEmail: admin.email, start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC" } });

    expect(result).toMatchObject({ status: 502, body: { error: "CloudShare could not fully revalidate this Demo Item. Review support diagnostics before retrying.", correlationId: expect.any(String) } });
  });

  it("returns a created needs-attention response if evidence fails after local persistence", async () => {
    const records = createInMemorySalesRecordRepository(); await records.saveOpportunity({ id: "opp-1", customerId: "certalis", accountId: "account-1", name: "Acme", status: "open", archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const item = { id: "item-1", customerId: "certalis", name: "Demo", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" };
    const result = await handleCreateSalesDemoSession({ records, items: { findById: vi.fn().mockResolvedValue(item) }, sessions: { save: vi.fn().mockResolvedValue(undefined), listByOpportunity: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, deliveryFactory: { forConnection: vi.fn().mockReturnValue({ createSession: vi.fn().mockResolvedValue({ salesExperienceId: "sales-created", request: { method: "POST", path: "/sales", headers: { "x-request": "safe" }, body: {} }, response: { status: 201, headers: { "x-cloud": "created" }, body: { id: "sales-created" } } }) }) }, projectMembers, diagnostics: { record: vi.fn().mockRejectedValue(new Error("diagnostics unavailable")) }, audit: { write: vi.fn().mockRejectedValue(new Error("audit unavailable")) } }, { customerId: "certalis", actor: admin, body: { opportunityId: "opp-1", itemId: "item-1", salesProEmail: admin.email, start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC" } });
    expect(result).toMatchObject({ status: 201, body: { session: { salesProDisplayName: "Sales Admin" }, needsAttention: true, correlationId: expect.any(String) } });
    expect(JSON.stringify(result.body)).not.toContain("sales-created");
  });

  it("blocks legacy Opportunity names that exceed CloudShare's v4 limit before any delivery call", async () => {
    const records = createInMemorySalesRecordRepository(); await records.saveOpportunity({ id: "opp-1", customerId: "certalis", accountId: "account-1", name: "x".repeat(101), status: "open", archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const delivery = { createSession: vi.fn() };
    const result = await handleCreateSalesDemoSession({ records, items: { findById: vi.fn() }, sessions: { save: vi.fn(), listByOpportunity: vi.fn() }, connections: { findByCustomerId: vi.fn() }, deliveryFactory: { forConnection: vi.fn().mockReturnValue(delivery) }, diagnostics: { record: vi.fn() }, audit: { write: vi.fn() } }, { customerId: "certalis", actor: admin, body: { opportunityId: "opp-1", itemId: "item-1", salesProEmail: admin.email, start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC" } });
    expect(result).toMatchObject({ status: 422, body: { correlationId: expect.any(String) } });
    expect(delivery.createSession).not.toHaveBeenCalled();
  });

  it("blocks provisioning with correlated diagnostics when the fresh Project-member read fails", async () => {
    const records = createInMemorySalesRecordRepository();
    await records.saveOpportunity({ id: "opp-1", customerId: "certalis", accountId: "account-1", name: "Acme", status: "open", archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const diagnostics = { record: vi.fn().mockResolvedValue(undefined) };
    const result = await handleCreateSalesDemoSession({
      records, items: { findById: vi.fn().mockResolvedValue({ id: "item-1", customerId: "certalis", name: "Demo", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" }) },
      sessions: { save: vi.fn(), listByOpportunity: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, deliveryFactory: { forConnection: vi.fn().mockReturnValue({ createSession: vi.fn() }) },
      projectMembers: { listActiveProjectMembers: vi.fn().mockRejectedValue(new CloudShareRequestError("active-member lookup failed", 503, { method: "GET", path: "/api/v3/users", requestQuery: { projectUsers: "true" } })) }, diagnostics, audit: { write: vi.fn() },
    }, { customerId: "certalis", actor: admin, body: { opportunityId: "opp-1", itemId: "item-1", salesProEmail: admin.email, start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC" } });
    expect(result).toMatchObject({ status: 502, body: { error: "CloudShare could not retrieve active Project members. Review support diagnostics before retrying.", correlationId: expect.any(String) } });
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure", details: expect.objectContaining({ integrationSurface: "cloudshare.v3.project_members_gui", failureMode: "project_member_read" }) }));
  });
});
