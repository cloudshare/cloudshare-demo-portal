import { describe, expect, it, vi } from "vitest";
import { handleCreateSalesDemoSession as createSalesDemoSession, type SalesDemoSessionDeps, type SalesDemoSessionRequest } from "./sales-demo-sessions";
import { SalesDemoSessionRevisionConflictError, type SalesDemoSession } from "@/domain/sales-demo-session";
import { createInMemorySalesRecordRepository } from "@/domain/sales-records";
import { CloudShareRequestError, CloudShareTransportError } from "@/integrations/cloudshare/errors";
import { SalesItemProvisioningReadError } from "@/integrations/cloudshare/sales-item-provisioning";

const admin = { type: "admin", id: "sales-admin", email: "sales-admin@certalis.demo" };
const projectMembers = {
  listActiveProjectMembers: vi.fn().mockResolvedValue({
    members: [{ email: admin.email, displayName: "Sales Admin" }],
    request: { method: "GET", path: "/users", query: { projectUsers: "true", status: "active", projectId: "project-1", getRows: "true" } },
    response: { status: 200, body: { Rows: [] } }, integrationSurface: "cloudshare.v3.project_members_gui",
  }),
};
const documentedTimezones = { find: vi.fn().mockResolvedValue({ customerId: "certalis", timezones: [{ id: "UTC", name: "UTC" }, { id: "Mountain Standard Time", name: "Mountain" }], fetchedAt: new Date("2026-07-15T00:00:00.000Z") }) };
const handleCreateSalesDemoSession = (deps: SalesDemoSessionDeps, request: SalesDemoSessionRequest) => createSalesDemoSession({ ...deps, timezones: deps.timezones ?? documentedTimezones }, request);

describe("Sales Enablement Session API handler", () => {
  it("fails closed when the Customer has no verified CloudShare timezone catalogue", async () => {
    const delivery = { createSession: vi.fn() };
    const result = await createSalesDemoSession({ records: { findOpportunity: vi.fn() }, items: { findById: vi.fn() }, sessions: { save: vi.fn(), listByOpportunity: vi.fn() }, connections: { findByCustomerId: vi.fn() }, deliveryFactory: { forConnection: vi.fn().mockReturnValue(delivery) }, timezones: { find: vi.fn().mockResolvedValue(null) } }, { customerId: "certalis", actor: admin, body: { opportunityId: "opp-1", itemId: "item-1", salesProEmail: admin.email, start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "Line Islands Standard Time" } });

    expect(result).toMatchObject({ status: 422, body: { error: "Refresh the documented CloudShare timezone catalogue before creating a Sales Enablement Session." } });
    expect(delivery.createSession).not.toHaveBeenCalled();
  });

  it("reserves the revision before CloudShare and never calls any CloudShare surface if that reservation collides", async () => {
    const records = createInMemorySalesRecordRepository(); await records.saveOpportunity({ id: "opp-1", customerId: "certalis", accountId: "account-1", name: "Acme", status: "open", archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const delivery = { createSession: vi.fn() };
    const members = { listActiveProjectMembers: vi.fn() };
    const result = await handleCreateSalesDemoSession({ records, items: { findById: vi.fn().mockResolvedValue({ id: "item-1", customerId: "certalis", name: "Demo", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" }) }, sessions: { save: vi.fn().mockRejectedValue(new SalesDemoSessionRevisionConflictError()), updateOperationalState: vi.fn(), listByOpportunity: vi.fn().mockResolvedValue([]) }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, deliveryFactory: { forConnection: vi.fn().mockReturnValue(delivery) }, projectMembers: members, itemProvisioningValidator: { revalidate: vi.fn() }, diagnostics: { record: vi.fn() }, audit: { write: vi.fn() } }, { customerId: "certalis", actor: admin, body: { opportunityId: "opp-1", itemId: "item-1", salesProEmail: admin.email, start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC" } });
    expect(result).toMatchObject({ status: 409, body: { correlationId: expect.any(String) } }); expect(delivery.createSession).not.toHaveBeenCalled(); expect(members.listActiveProjectMembers).not.toHaveBeenCalled();
  });
  it("reports a retryable local persistence failure with diagnostic and audit evidence without CloudShare calls", async () => {
    const records = createInMemorySalesRecordRepository(); await records.saveOpportunity({ id: "opp-1", customerId: "certalis", accountId: "account-1", name: "Acme", status: "open", archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const delivery = { createSession: vi.fn() }; const members = { listActiveProjectMembers: vi.fn() }; const diagnostics = { record: vi.fn() }; const audit = { write: vi.fn() };
    const result = await handleCreateSalesDemoSession({ records, items: { findById: vi.fn().mockResolvedValue({ id: "item-1", customerId: "certalis", name: "Demo", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" }) }, sessions: { save: vi.fn().mockRejectedValue(new Error("database transport unavailable")), updateOperationalState: vi.fn(), listByOpportunity: vi.fn().mockResolvedValue([]) }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, deliveryFactory: { forConnection: vi.fn().mockReturnValue(delivery) }, projectMembers: members, itemProvisioningValidator: { revalidate: vi.fn() }, diagnostics, audit }, { customerId: "certalis", actor: admin, body: { opportunityId: "opp-1", itemId: "item-1", salesProEmail: admin.email, start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC" } });
    expect(result).toMatchObject({ status: 503, body: { correlationId: expect.any(String), needsAttention: false, creationOutcome: { dimension: "certalis_creation", value: "not_created", source: "certalis_pre_dispatch", retry: "safe" } } });
    expect(delivery.createSession).not.toHaveBeenCalled(); expect(members.listActiveProjectMembers).not.toHaveBeenCalled();
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure", details: expect.objectContaining({ failureMode: "local_reservation_persistence", cloudShareAttempted: false }) }));
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure", details: expect.objectContaining({ failureMode: "local_reservation_persistence", cloudShareAttempted: false }) }));
  });
  it("allows an ordinary retry after an unreserved local persistence failure", async () => {
    const records = createInMemorySalesRecordRepository(); await records.saveOpportunity({ id: "opp-1", customerId: "certalis", accountId: "account-1", name: "Acme", status: "open", archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const item = { id: "item-1", customerId: "certalis", name: "Demo", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" };
    const delivery = { createSession: vi.fn().mockResolvedValue({ salesExperienceId: "sales-1", request: {}, response: {} }) };
    const save = vi.fn().mockRejectedValueOnce(new Error("database transport unavailable")).mockResolvedValue(undefined);
    const deps = { records, items: { findById: vi.fn().mockResolvedValue(item) }, sessions: { save, updateOperationalState: vi.fn().mockResolvedValue(undefined), listByOpportunity: vi.fn().mockResolvedValue([]) }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, deliveryFactory: { forConnection: vi.fn().mockReturnValue(delivery) }, projectMembers, diagnostics: { record: vi.fn() }, audit: { write: vi.fn() }, newId: vi.fn().mockReturnValueOnce("failed-reservation").mockReturnValueOnce("retried-reservation") };
    const request = { customerId: "certalis", actor: admin, body: { opportunityId: "opp-1", itemId: "item-1", salesProEmail: admin.email, start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC" } };
    expect((await handleCreateSalesDemoSession(deps, request)).status).toBe(503);
    expect((await handleCreateSalesDemoSession(deps, request)).status).toBe(201);
    expect(delivery.createSession).toHaveBeenCalledOnce();
  });
  it("removes only its own persisted-but-unacknowledged reservation before a retry", async () => {
    const records = createInMemorySalesRecordRepository(); await records.saveOpportunity({ id: "opp-1", customerId: "certalis", accountId: "account-1", name: "Acme", status: "open", archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const item = { id: "item-1", customerId: "certalis", name: "Demo", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" };
    const stored: SalesDemoSession[] = []; const save = vi.fn(async (value: SalesDemoSession) => { stored.push(value); if (value.id === "ambiguous") throw new Error("connection lost after commit"); });
    const discardReservation = vi.fn(async (value: SalesDemoSession) => { const index = stored.findIndex((storedValue) => storedValue.id === value.id && storedValue.customerId === value.customerId && storedValue.opportunityId === value.opportunityId && storedValue.revision === value.revision && storedValue.cloudShareSalesExperienceId === value.cloudShareSalesExperienceId); if (index < 0) return false; stored.splice(index, 1); return true; });
    const delivery = { createSession: vi.fn().mockResolvedValue({ salesExperienceId: "sales-1", request: {}, response: {} }) };
    const deps = { records, items: { findById: vi.fn().mockResolvedValue(item) }, sessions: { save, findById: vi.fn(async (_customerId, id) => stored.find((value) => value.id === id) ?? null), discardReservation, updateOperationalState: vi.fn(), listByOpportunity: vi.fn(async () => stored) }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, deliveryFactory: { forConnection: vi.fn().mockReturnValue(delivery) }, projectMembers, diagnostics: { record: vi.fn() }, audit: { write: vi.fn() }, newId: vi.fn().mockReturnValueOnce("ambiguous").mockReturnValueOnce("retry") };
    const request = { customerId: "certalis", actor: admin, body: { opportunityId: "opp-1", itemId: "item-1", salesProEmail: admin.email, start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC" } };
    expect((await handleCreateSalesDemoSession(deps, request)).status).toBe(503);
    expect(discardReservation).toHaveBeenCalledWith(expect.objectContaining({ id: "ambiguous", cloudShareSalesExperienceId: "pending:ambiguous" }));
    expect(stored).toEqual([]); expect(delivery.createSession).not.toHaveBeenCalled();
    expect((await handleCreateSalesDemoSession(deps, request)).status).toBe(201); expect(delivery.createSession).toHaveBeenCalledOnce();
  });
  it.each([
    ["transport failure", () => new CloudShareTransportError("POST /sales timed out without a response", { method: "POST", path: "/sales", requestBody: { externalId: "server-only" } })],
    ["HTTP 503 response", () => new CloudShareRequestError("POST /sales returned 503", 503, { method: "POST", path: "/sales", requestBody: { externalId: "server-only" }, responseStatus: 503, responseBody: { error: "unavailable" } })],
  ])("blocks a duplicate attempt after an outcome-ambiguous CloudShare POST %s", async (_failure, createFailure) => {
    const records = createInMemorySalesRecordRepository(); await records.saveOpportunity({ id: "opp-1", customerId: "certalis", accountId: "account-1", name: "Acme", status: "open", archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const item = { id: "item-1", customerId: "certalis", name: "Demo", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" };
    const stored: SalesDemoSession[] = [];
    const sessions = { save: vi.fn(async (session: SalesDemoSession) => { stored.push(session); }), listByOpportunity: vi.fn(async () => stored), updateOperationalState: vi.fn(async (customerId: string, id: string, state: Partial<SalesDemoSession>) => { const index = stored.findIndex((session) => session.customerId === customerId && session.id === id); if (index < 0) throw new Error("missing"); stored[index] = { ...stored[index]!, ...state }; }) };
    const delivery = { createSession: vi.fn().mockRejectedValue(createFailure()) };
    const diagnostics = { record: vi.fn() };
    const deps = { records, items: { findById: vi.fn().mockResolvedValue(item) }, sessions, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, deliveryFactory: { forConnection: vi.fn().mockReturnValue(delivery) }, projectMembers, diagnostics, audit: { write: vi.fn() }, newId: vi.fn().mockReturnValueOnce("ambiguous-session").mockReturnValueOnce("duplicate-session") };
    const request = { customerId: "certalis", actor: admin, body: { opportunityId: "opp-1", itemId: "item-1", salesProEmail: admin.email, start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC" } };

    const first = await handleCreateSalesDemoSession(deps, request);
    const second = await handleCreateSalesDemoSession(deps, request);

    expect(first).toMatchObject({ status: 502, body: { needsAttention: true, creationOutcome: { dimension: "certalis_creation", value: "needs_attention", source: "cloudshare_v4_post_sales_ambiguous", retry: "unsafe_requires_support", reason: expect.stringContaining("outcome is unknown"), sessionId: "ambiguous-session" } } });
    expect(second).toMatchObject({ status: 409, body: { needsAttention: true, creationOutcome: { source: "cloudshare_v4_post_sales_ambiguous", retry: "unsafe_requires_support", sessionId: "ambiguous-session" } } });
    expect(delivery.createSession).toHaveBeenCalledOnce();
    expect(sessions.save).toHaveBeenCalledOnce();
    expect(stored[0]).toMatchObject({ id: "ambiguous-session", cloudShareSalesExperienceId: "pending:ambiguous-session", operationalStatus: "needs_attention", attentionReason: expect.stringContaining("cloudshare_v4_post_sales_ambiguous") });
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ correlationId: second.body.correlationId, subject: { type: "sales_demo_session", id: "ambiguous-session" }, details: expect.objectContaining({ failureMode: "cloudshare_create_duplicate_blocked" }) }));
    expect(JSON.stringify(first.body)).not.toContain("server-only");
  });
  it("keeps reservation failure classification scoped to the requesting Customer", async () => {
    const records = { findOpportunity: vi.fn(async (customerId: string, opportunityId: string) => opportunityId !== "opp-shared" ? null : { id: opportunityId, customerId, accountId: `${customerId}-account`, name: customerId, status: "open" as const, archivedAt: null, createdAt: new Date(), updatedAt: new Date() }) };
    const item = { id: "item-shared", customerId: "certalis", name: "Demo", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" };
    const delivery = { createSession: vi.fn().mockResolvedValue({ salesExperienceId: "sales-helios", request: {}, response: {} }) };
    const sessions = { save: vi.fn(async (value: SalesDemoSession) => { if (value.customerId === "certalis") throw new SalesDemoSessionRevisionConflictError(); }), updateOperationalState: vi.fn(), listByOpportunity: vi.fn().mockResolvedValue([]) };
    const makeDeps = (customerId: string) => ({ records, items: { findById: vi.fn().mockResolvedValue({ ...item, customerId }) }, sessions, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId }) }, deliveryFactory: { forConnection: vi.fn().mockReturnValue(delivery) }, projectMembers, diagnostics: { record: vi.fn() }, audit: { write: vi.fn() }, newId: () => `${customerId}-session` });
    const body = { opportunityId: "opp-shared", itemId: "item-shared", salesProEmail: admin.email, start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC" };
    expect((await handleCreateSalesDemoSession(makeDeps("certalis"), { customerId: "certalis", actor: admin, body })).status).toBe(409);
    expect((await handleCreateSalesDemoSession(makeDeps("helios"), { customerId: "helios", actor: admin, body })).status).toBe(201);
    expect(delivery.createSession).toHaveBeenCalledOnce();
  });
  it("creates one Customer-scoped registered-only Sales Experience and records correlated evidence", async () => {
    const records = createInMemorySalesRecordRepository();
    await records.saveOpportunity({ id: "opp-1", customerId: "certalis", accountId: "account-1", name: "Acme evaluation", status: "open", archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const items = { findById: vi.fn().mockResolvedValue({ id: "item-1", customerId: "certalis", name: "Accelerate Demo", description: "", project: { id: "project-1", name: "Certalis project" }, blueprints: [{ id: "bp-1", name: "Foundation" }], policy: { id: "policy-1", name: "Sales policy" }, regions: [{ id: "region-1", name: "US West" }], salesExperienceType: "demo", defaultDurationMinutes: 1440, status: "active" }) };
    const saved: SalesDemoSession[] = [];
    const sessions = { save: vi.fn(async (session) => { saved.push(session); }), listByOpportunity: vi.fn(async () => saved) };
    const delivery = { createSession: vi.fn().mockResolvedValue({ salesExperienceId: "sales-1", request: { method: "POST", path: "/sales", body: {} }, response: { status: 201, body: { id: "sales-1" } } }) };
    const diagnostics = { record: vi.fn().mockResolvedValue(undefined) };
    const audit = { write: vi.fn().mockResolvedValue(undefined) };
    const itemProvisioningValidator = { revalidate: vi.fn().mockResolvedValue([{ request: { method: "GET", path: "/projects/project-1/blueprints" }, response: { status: 200 }, integrationSurface: "cloudshare.v3.projects.blueprints" }]) };

    const result = await handleCreateSalesDemoSession({ records, items, sessions, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, deliveryFactory: { forConnection: vi.fn().mockReturnValue(delivery) }, projectMembers, itemProvisioningValidator, diagnostics, audit, now: () => new Date("2026-07-14T15:00:00.000Z"), newId: () => "session-1" }, { customerId: "certalis", actor: admin, body: { opportunityId: "opp-1", itemId: "item-1", salesProEmail: admin.email, start: "2026-07-15T09:00", end: "2026-07-16T09:00", timeZone: "Mountain Standard Time", type: "poc" } });

    expect(result).toMatchObject({ status: 201, body: { session: { id: "session-1", opportunityId: "opp-1", itemId: "item-1", salesProDisplayName: "Sales Admin" } } });
    expect(JSON.stringify(result.body)).not.toContain("cloudShareSalesExperienceId");
    expect(JSON.stringify(result.body)).not.toContain("sales-1");
    expect(delivery.createSession).toHaveBeenCalledWith(expect.objectContaining({ name: "Account - Acme evaluation (1) - Accelerate Demo", opportunity: "Acme evaluation", externalId: "session1", passphrase: expect.stringMatching(/^[A-Za-z0-9]{32}$/), registrationType: "registeredParticipantsOnly", sendInvitations: "salesProsAndParticipants", mainSalesProEmail: admin.email, type: "poc" }));
    expect(sessions.save).toHaveBeenCalledWith(expect.objectContaining({ opportunityId: "opp-1", itemId: "item-1" }));
    expect(itemProvisioningValidator.revalidate).toHaveBeenCalledWith(expect.objectContaining({ id: "item-1" }));
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: "sales.demo_session.created", correlationId: expect.any(String), outcome: "success" }));
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ operation: "sales.demo_session.created", details: expect.objectContaining({ integrationSurface: "cloudshare.v4.sales", registrationType: "registeredParticipantsOnly" }) }));

    await handleCreateSalesDemoSession({ records, items, sessions, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, deliveryFactory: { forConnection: vi.fn().mockReturnValue(delivery) }, projectMembers, itemProvisioningValidator, diagnostics, audit, now: () => new Date("2026-07-14T15:00:00.000Z"), newId: () => "session-2" }, { customerId: "certalis", actor: admin, body: { opportunityId: "opp-1", itemId: "item-1", salesProEmail: admin.email, start: "2026-07-16T09:00", end: "2026-07-17T09:00", timeZone: "Mountain Standard Time", type: "poc" } });

    const [first, second] = delivery.createSession.mock.calls.map(([input]) => input);
    expect(first.name).not.toBe(second.name);
    expect(first.name).toMatch(/\(1\) - Accelerate Demo$/);
    expect(second.name).toMatch(/\(2\) - Accelerate Demo$/);
    expect(first.name.length).toBeLessThanOrEqual(100);
    expect(second.name.length).toBeLessThanOrEqual(100);
  });

  it("records protected creation failure when the Customer-scoped correlation row disappears after CloudShare succeeds", async () => {
    const records = createInMemorySalesRecordRepository(); await records.saveOpportunity({ id: "opp-1", customerId: "certalis", accountId: "account-1", name: "Acme", status: "open", archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const diagnostics = { record: vi.fn() };
    const updateOperationalState = vi.fn().mockRejectedValue(new Error("Sales Enablement Session was not found for this Customer"));
    const result = await handleCreateSalesDemoSession({ records, items: { findById: vi.fn().mockResolvedValue({ id: "item-1", customerId: "certalis", name: "Demo", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" }) }, sessions: { save: vi.fn(), updateOperationalState, listByOpportunity: vi.fn().mockResolvedValue([]) }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, deliveryFactory: { forConnection: () => ({ createSession: vi.fn().mockResolvedValue({ salesExperienceId: "sales-1", request: { method: "POST", path: "/sales" }, response: { status: 201 } }) } as never) }, projectMembers, diagnostics, audit: { write: vi.fn() } }, { customerId: "certalis", actor: admin, body: { opportunityId: "opp-1", itemId: "item-1", salesProEmail: admin.email, start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC" } });

    expect(result).toMatchObject({ status: 503, body: { needsAttention: true, correlationId: expect.any(String) } });
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure", details: expect.objectContaining({ failureMode: "local_correlation_persistence", createdSalesExperienceId: "sales-1" }) }));
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

    expect(result).toMatchObject({ status: 502, body: { error: "CloudShare could not fully revalidate this Item. Review support diagnostics before retrying.", correlationId: expect.any(String) } });
  });

  it("returns a created needs-attention response if evidence fails after local persistence", async () => {
    const records = createInMemorySalesRecordRepository(); await records.saveOpportunity({ id: "opp-1", customerId: "certalis", accountId: "account-1", name: "Acme", status: "open", archivedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const item = { id: "item-1", customerId: "certalis", name: "Demo", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" };
    const updateOperationalState = vi.fn().mockResolvedValue(undefined);
    const result = await handleCreateSalesDemoSession({ records, items: { findById: vi.fn().mockResolvedValue(item) }, sessions: { save: vi.fn().mockResolvedValue(undefined), updateOperationalState, listByOpportunity: vi.fn().mockResolvedValue([]) }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, deliveryFactory: { forConnection: vi.fn().mockReturnValue({ createSession: vi.fn().mockResolvedValue({ salesExperienceId: "sales-created", request: { method: "POST", path: "/sales", headers: { "x-request": "safe" }, body: {} }, response: { status: 201, headers: { "x-cloud": "created" }, body: { id: "sales-created" } } }) }) }, projectMembers, diagnostics: { record: vi.fn().mockRejectedValue(new Error("diagnostics unavailable")) }, audit: { write: vi.fn().mockRejectedValue(new Error("audit unavailable")) } }, { customerId: "certalis", actor: admin, body: { opportunityId: "opp-1", itemId: "item-1", salesProEmail: admin.email, start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC" } });
    expect(result).toMatchObject({ status: 201, body: { session: { salesProDisplayName: "Sales Admin" }, needsAttention: true, correlationId: expect.any(String) } });
    expect(updateOperationalState).toHaveBeenLastCalledWith("certalis", expect.any(String), expect.objectContaining({ operationalStatus: "needs_attention", attentionReason: expect.stringContaining("support") }));
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
