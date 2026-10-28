import { describe, expect, it, vi } from "vitest";
import { handleCancelSalesDemoSession, type SalesCancellationDependencies } from "./sales-demo-session-cancellation";
import { createInMemorySalesCancellationStore } from "@/persistence/in-memory-sales-session-cancellation";
import type { SalesEnvironmentSource } from "@/integrations/cloudshare/sales-environment";
import type { EnvironmentController } from "@/domain/environment";
import { SalesEnvironmentResolutionError } from "@/integrations/cloudshare/sales-environment";
import { handleCreateSalesParticipantLaunchLink, handleSalesParticipantLaunch } from "./sales-participant-launch";
import { handleExtendSalesParticipants } from "./sales-participant-extension";
import { createInMemorySalesParticipantExtensionCommandStore } from "@/persistence/in-memory-sales-participant-extension-command";
import { CloudShareRequestError } from "@/integrations/cloudshare/errors";
import { handleRegisterSalesSessionParticipants } from "./sales-session-participants";
import { createCloudShareSalesDelivery } from "@/integrations/cloudshare/sales-delivery";
import { createCloudShareClient, createCloudShareNoopRequestObserver } from "@/integrations/cloudshare/client";
import type { HttpClient } from "@/integrations/cloudshare/http";
const exchange = { request: { method: "GET" as const, path: "/fixture" }, response: { status: 200, body: null } };
function fixture() {
  const now = new Date("2026-09-19T10:00:00Z");
  const commands = createInMemorySalesCancellationStore();
  let end = "2026-09-20T10:00", archived = false;
  let labels: string[] = [];
  const environments: Required<SalesEnvironmentSource> = {
    observe: vi.fn<SalesEnvironmentSource["observe"]>(async () => ({ environmentId: "opaque/v3+id", statusCode: 2, expirationTime: "2026-09-20T10:00:00Z", exchanges: [exchange] })),
    observeById: vi.fn<NonNullable<SalesEnvironmentSource["observeById"]>>(async id => ({ environmentId: id, statusCode: archived ? 4 : 2, expirationTime: "2026-09-20T10:00:00Z", exchanges: [exchange] })),
    extendById: vi.fn<NonNullable<SalesEnvironmentSource["extendById"]>>(async id => ({ environmentId: id, exchange })),
  };
  const controller: Pick<EnvironmentController, "archiveEnvironment"> = { archiveEnvironment: vi.fn<EnvironmentController["archiveEnvironment"]>(async id => {
    expect((await commands.read("c1", "12345678-1234-4234-8234-123456789abc"))?.targets).toMatchObject([{ environmentId: id, state: "dispatched" }]);
    archived = true;
    return { attemptedOperation: "archive_environment", integrationSurface: "cloudshare.v3.env.action.archive", method: "PUT", path: "/envs/actions/archive", externalIds: { environmentId: id }, request: exchange.request, response: exchange.response };
  }) };
  const delivery: ReturnType<SalesCancellationDependencies["provider"]>["delivery"] = {
    readSession: vi.fn<ReturnType<SalesCancellationDependencies["provider"]>["delivery"]["readSession"]>(async () => ({ id: "experience1", status: "inProgress", start: "2026-09-19T09:00", timeZone: "UTC", end, labels, ...exchange })),
    listParticipants: vi.fn<ReturnType<SalesCancellationDependencies["provider"]>["delivery"]["listParticipants"]>(async () => ({ completeness: "complete", provenance: { expectedCount: 1, returnedCount: 1, offsets: [0] }, participants: [{ id: "remote1", email: "ada@example.test", firstName: "Ada", lastName: "Example", invitationStatus: "notSent", invitedBy: null, firstJoined: null, participationStatus: "inProgress", envStatus: "Ready", environmentId: "17", customProperties: { certalisSalesParticipantId: "p1", certalisOpportunityContactId: "contact1" } }], ...exchange })),
    updateSession: vi.fn<ReturnType<SalesCancellationDependencies["provider"]>["delivery"]["updateSession"]>(async (id, changes, beforeDispatch) => { await beforeDispatch?.(); end = changes.end!; if (changes.cancelled) labels = ["certalis:cancelled"]; return { id, ...exchange }; }),
  };
  const deps: SalesCancellationDependencies = {
    commands, provider: () => ({ delivery, environments, controller }),
    sessions: { findById: async customerId => customerId === "c1" ? { id: "s1", customerId: "c1", opportunityId: "op1", itemId: "item1", cloudShareSalesExperienceId: "experience1", externalId: "external1", type: "demo", start: "2026-09-19T09:00", end, timeZone: "UTC", salesProEmail: "sales@example.test", salesProDisplayName: "Sales", registrationType: "registeredParticipantsOnly", sendInvitations: "dontSend", operationalStatus: "active", createdAt: now } : null, updateEnd: vi.fn(async () => {}) },
    participants: { list: vi.fn<SalesCancellationDependencies["participants"]["list"]>(async () => [{ id: "p1", customerId: "c1", salesDemoSessionId: "s1", opportunityContactId: "contact1", cloudShareParticipantId: "remote1", invitationStatus: "notSent", lastInvitedAt: null, invitedBy: null, participationStatus: "inProgress", firstJoined: "2026-09-19T09:00:00Z", environmentStatus: "Ready", lastReconciledAt: now, createdAt: now, updatedAt: now }]) },
    records: { findContact: vi.fn(async () => ({ id: "contact1", customerId: "c1", opportunityId: "op1", firstName: "Ada", lastName: "Example", email: "ada@example.test", archivedAt: null, createdAt: now, updatedAt: now })) },
    items: { findById: async () => ({ id: "item1", customerId: "c1", name: "Item", description: "", project: { id: "project1", name: "Project" }, blueprints: [], policy: { id: "policy1", name: "Policy" }, regions: [], defaultDurationMinutes: 60, status: "active", archivedAt: null, createdAt: now, updatedAt: now }) },
    connections: { findByCustomerId: async () => ({ customerId: "c1", apiId: "fixture", apiKey: "fixture", webhookSecret: "fixture", webhookPathToken: "fixture", connectedAt: now, verifiedAt: now }) },
    audit: { write: vi.fn(async () => {}) }, diagnostics: { record: vi.fn(async () => {}) }, now: () => now,
  };
  const request = { customerId: "c1", sessionId: "s1", actor: { type: "admin", id: "actor1" }, body: { commandId: "12345678-1234-4234-8234-123456789abc", confirmed: true } };
  return { deps, request, environments, delivery, controller, setArchived: () => { archived = true; } };
}
describe("Sales cancellation API", () => {
  it.each([8, 2] as const)("archives Preparing before ending the Experience when initial status is %s, without replay", async initialStatus => {
    const f = fixture();
    const observed = { environmentId: "opaque/v3+id", expirationTime: "2026-09-20T10:00:00Z", exchanges: [exchange] };
    vi.mocked(f.environments.observe)
      .mockResolvedValueOnce({ ...observed, statusCode: initialStatus })
      .mockResolvedValueOnce({ ...observed, statusCode: 8 });
    expect(await handleCancelSalesDemoSession(f.deps, f.request)).toMatchObject({ status: 200, body: { outcome: "cancelled", targets: [{ outcome: "archived" }] } });
    expect(f.controller.archiveEnvironment).toHaveBeenCalledWith("opaque/v3+id");
    expect(f.environments.observeById).toHaveBeenCalledWith("opaque/v3+id");
    expect(vi.mocked(f.controller.archiveEnvironment).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(f.delivery.updateSession).mock.invocationCallOrder[0]!);
    for (const flags of [{}, { retrySafe: true }, { reconcile: true }]) {
      expect(await handleCancelSalesDemoSession(f.deps, { ...f.request, body: { ...f.request.body, ...flags } })).toMatchObject({ status: 200 });
    }
    expect(f.controller.archiveEnvironment).toHaveBeenCalledTimes(1);
    expect(f.delivery.updateSession).toHaveBeenCalledTimes(1);
  });
  it.each(["GET failure", "incomplete GET", "fence failure", "ambiguous PUT"])("fences only the prepared End PUT after %s and retries only undispatched work", async failure => {
    const f = fixture();
    await f.deps.commands.admit({ customerId: "c1", sessionId: "s1", commandId: f.request.body.commandId, experienceId: "experience1", cancelledAt: "2026-09-19T10:00:00Z", actor: f.request.actor, timeZone: "UTC", targetEnd: "2026-09-19T10:00", targets: [] });
    const full = { id: "experience1", status: "inProgress", name: "Retained", type: "demo", projectId: "project1", blueprintIds: ["bp1"], cloudshareRegionIds: ["region1"], policyId: "policy1", opportunity: "Opportunity", mainSalesPro: { email: "sales@example.test" }, registrationType: "registeredParticipantsOnly", start: "2026-09-19T09:00", end: "2026-09-20T10:00", timeZone: "UTC", labels: ["customer-label"] };
    let failing = true;
    const wire: string[] = [];
    const states: string[] = [];
    const send: HttpClient["send"] = async request => {
      wire.push(request.method);
      states.push((await f.deps.commands.read("c1", f.request.body.commandId))!.accessState);
      if (request.method === "GET" && failing && failure === "GET failure") return { status: 503, body: "unavailable" };
      if (request.method === "GET" && failing && failure === "incomplete GET") return { status: 200, body: JSON.stringify({ id: "experience1" }) };
      if (request.method === "PUT") {
        if (failing && failure === "ambiguous PUT") throw new Error("lost PUT response");
        Object.assign(full, JSON.parse(request.body!));
      }
      return { status: 200, body: JSON.stringify(full) };
    };
    const real = createCloudShareSalesDelivery(createCloudShareClient({ http: { send }, endpoints: { v4BaseUrl: "https://fixture.test/v4", v3BaseUrl: "https://fixture.test/v3" }, tokenProvider: { getToken: async () => "fixture" }, v3: { apiId: "fixture", apiKey: "fixture" }, observer: createCloudShareNoopRequestObserver() }));
    f.delivery.updateSession = real.updateSession!;
    f.delivery.readSession = real.readSession;
    const save = f.deps.commands.save.bind(f.deps.commands);
    f.deps.commands.save = async (command, revision) => failing && failure === "fence failure" && command.accessState === "dispatched" ? false : save(command, revision);
    const retry = { ...f.request, body: { ...f.request.body, retrySafe: true } };
    const ambiguous = failure === "ambiguous PUT";
    expect(await handleCancelSalesDemoSession(f.deps, retry)).toMatchObject({ status: 202, body: { accessRetryable: !ambiguous } });
    expect(states[0]).toBe("pending");
    expect(wire.filter(method => method === "PUT")).toHaveLength(ambiguous ? 1 : 0);
    expect(await f.deps.commands.read("c1", f.request.body.commandId)).toMatchObject({ accessState: ambiguous ? "dispatched" : "pending" });
    failing = false;
    expect(await handleCancelSalesDemoSession(f.deps, f.request)).toMatchObject({ status: 202 }); // No implicit retry.
    expect(await handleCancelSalesDemoSession(f.deps, retry)).toMatchObject({ status: ambiguous ? 202 : 200, body: { accessRetryable: false } });
    expect(wire.filter(method => method === "PUT")).toHaveLength(1);
    expect(states[wire.indexOf("PUT")]).toBe("dispatched");
    if (!ambiguous) expect(full).toMatchObject({ start: "2026-09-19T09:00", end: "2026-09-19T10:00", labels: ["customer-label", "certalis:cancelled"] });
  });
  it("keeps a lost DELETE fenced and reconciles only the exact Experience GET", async () => {
    const f = fixture();
    let dispatched = false, absent = false;
    vi.mocked(f.delivery.readSession).mockImplementation(async () => {
      if (absent) throw new CloudShareRequestError("Not found", 404);
      if (dispatched) throw new Error("Read unavailable");
      return { id: "experience1", status: "notStarted", start: "2026-09-20T10:00", timeZone: "UTC", ...exchange };
    });
    const deleteSession = vi.fn(async () => {
      expect((await f.deps.commands.read("c1", f.request.body.commandId))?.deletion?.state).toBe("dispatched");
      dispatched = true;
      throw new Error("DELETE response lost");
    });
    Object.assign(f.delivery, { deleteSession });
    expect(await handleCancelSalesDemoSession(f.deps, f.request)).toMatchObject({ status: 202, body: { experienceDeleted: false, accessRetryable: false, deletionPending: false } });
    expect(await handleCancelSalesDemoSession(f.deps, { ...f.request, body: { ...f.request.body, retrySafe: true } })).toMatchObject({ status: 202 });
    absent = true;
    expect(await handleCancelSalesDemoSession(f.deps, { ...f.request, body: { ...f.request.body, reconcile: true } })).toMatchObject({ status: 200, body: { experienceDeleted: true } });
    expect(deleteSession).toHaveBeenCalledTimes(1);
    expect(f.delivery.readSession).toHaveBeenLastCalledWith("experience1");
    expect(f.delivery.updateSession).not.toHaveBeenCalled();
  });
  it("uses the current provider timezone and refuses DELETE when Start crosses before dispatch", async () => {
    const f = fixture();
    // Local Session Start is 09:00 UTC. Provider 06:30 New York is 10:30 UTC.
    vi.mocked(f.delivery.readSession).mockResolvedValueOnce({ id: "experience1", status: "notStarted", start: "2026-09-19T06:30", timeZone: "America/New_York", ...exchange }).mockResolvedValue({ id: "experience1", status: "notStarted", start: "2026-09-19T05:30", timeZone: "America/New_York", ...exchange });
    const deleteSession = vi.fn(); Object.assign(f.delivery, { deleteSession });
    expect(await handleCancelSalesDemoSession(f.deps, f.request)).toMatchObject({ status: 202, body: { deletionPending: true } });
    expect(deleteSession).not.toHaveBeenCalled();
    expect(f.environments.observe).not.toHaveBeenCalled();
    expect(f.delivery.updateSession).not.toHaveBeenCalled();
  });
  it("adds an explicitly confirmed DELETE step without resetting a prior End dispatch", async () => {
    const f = fixture();
    const admitted = await f.deps.commands.admit({ customerId: "c1", sessionId: "s1", commandId: f.request.body.commandId, experienceId: "experience1", cancelledAt: "2026-09-19T09:30:00Z", actor: f.request.actor, timeZone: "UTC", targetEnd: "2026-09-19T09:30", targets: [] });
    await f.deps.commands.save({ ...admitted.command!, accessState: "dispatched" }, 1);
    let deleted = false;
    vi.mocked(f.delivery.readSession).mockImplementation(async () => {
      if (deleted) throw new CloudShareRequestError("Not found", 404);
      return { id: "experience1", status: "notStarted", start: "2026-09-20T10:00", timeZone: "UTC", ...exchange };
    });
    const deleteSession = vi.fn(async () => { deleted = true; return exchange; }); Object.assign(f.delivery, { deleteSession });
    expect(await handleCancelSalesDemoSession(f.deps, { ...f.request, body: { ...f.request.body, deleteFuture: true } })).toMatchObject({ status: 200, body: { experienceDeleted: true } });
    expect(await f.deps.commands.read("c1", f.request.body.commandId)).toMatchObject({ accessState: "dispatched", targetEnd: "2026-09-19T09:30", cancelledAt: "2026-09-19T09:30:00Z", deletion: { state: "confirmed" } });
    expect(f.delivery.updateSession).not.toHaveBeenCalled();
    expect(deleteSession).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, "Unrecognized/Zone"])("fails closed when provider timezone is %s", async timeZone => {
    const f = fixture();
    vi.mocked(f.delivery.readSession).mockResolvedValue({ id: "experience1", status: "notStarted", start: "2026-09-20T10:00", timeZone, ...exchange });
    const deleteSession = vi.fn(); Object.assign(f.delivery, { deleteSession });
    expect(await handleCancelSalesDemoSession(f.deps, f.request)).toMatchObject({ status: 502 });
    expect(deleteSession).not.toHaveBeenCalled();
    expect(await f.deps.commands.read("c1", f.request.body.commandId)).toBeNull();
  });
  it("deletes a future provider Experience once while preserving portal history", async () => {
    const f = fixture();
    let deleted = false;
    vi.mocked(f.delivery.readSession).mockImplementation(async () => {
      if (deleted) throw new CloudShareRequestError("Not found", 404);
      return { id: "experience1", status: "notStarted", start: "2026-09-19T16:30", timeZone: "UTC", end: "2026-09-20T16:30", ...exchange };
    });
    const deleteSession = vi.fn(async () => { deleted = true; return { request: { method: "DELETE" as const, path: "/sales/experience1" }, response: { status: 204 } }; });
    Object.assign(f.delivery, { deleteSession });
    expect(await handleCancelSalesDemoSession(f.deps, f.request)).toMatchObject({ status: 200, body: { outcome: "cancelled", experienceDeleted: true } });
    expect(deleteSession).toHaveBeenCalledTimes(1);
    expect(f.environments.observe).not.toHaveBeenCalled();
    expect(f.controller.archiveEnvironment).not.toHaveBeenCalled();
    expect(f.delivery.updateSession).not.toHaveBeenCalled();
    expect(f.deps.sessions.updateEnd).not.toHaveBeenCalled();
    expect(await f.deps.sessions.findById!("c1", "s1")).toMatchObject({ cloudShareSalesExperienceId: "experience1" });
    expect(await f.deps.participants.list("c1", "s1")).toHaveLength(1);
  });
  it("cancels a fully correlated Session whose creation diagnostics need attention", async () => {
    const f = fixture();
    const session = (await f.deps.sessions.findById!("c1", "s1"))!;
    f.deps.sessions.findById = async () => ({ ...session, operationalStatus: "needs_attention", attentionReason: "Certalis support evidence persistence failed after durable provider correlation" });
    expect(await handleCancelSalesDemoSession(f.deps, f.request)).toMatchObject({ status: 200 });
    expect(f.controller.archiveEnvironment).toHaveBeenCalledWith("opaque/v3+id");
  });
  it("blocks launch, link generation, participant registration and extension while cleanup is pending", async () => {
    const f = fixture();
    const session = (await f.deps.sessions.findById!("c1", "s1"))!;
    const sessions = { findById: async () => ({ ...session, cancellationRequestedAt: new Date("2026-09-19T10:00:00Z") }), updateEnd: f.deps.sessions.updateEnd };
    const participants = { ...f.deps.participants, save: async () => {}, recordEnvironmentObservation: async () => {} };
    const createClient = vi.fn(() => { throw new Error("provider must not be reached"); });
    const regenerate = vi.fn(async () => {});
    const createSponsoredLink = vi.fn(async () => ({ loginUrl: "https://fixture.test/secret", ...exchange }));
    const launchDeps: Parameters<typeof handleSalesParticipantLaunch>[0] = {
      ...f.deps, sessions, participants, cloudshare: { forConnection: createClient },
      deliveryFactory: { forConnection: () => ({ createSponsoredLink, listSalesPros: async () => ({ salesPros: [], ...exchange }) }) },
      links: { create: async () => {}, regenerate, revokeActive: async () => {}, recordFailure: async () => {}, findByTokenHash: async () => ({ id: "link1", customerId: "c1", salesDemoSessionId: "s1", salesSessionParticipantId: "p1", tokenHash: "hash", revokedAt: null, createdAt: new Date() }) },
    };
    expect((await handleSalesParticipantLaunch(launchDeps, "a".repeat(43))).status).toBe(404);
    expect((await handleCreateSalesParticipantLaunchLink(launchDeps, { ...f.request, participantId: "p1", actor: { type: "admin", id: "actor1", email: "admin@example.test" } })).status).toBe(409);
    expect(regenerate).not.toHaveBeenCalled(); expect(createClient).not.toHaveBeenCalled();
    expect(createSponsoredLink).not.toHaveBeenCalled();
    expect((await handleRegisterSalesSessionParticipants({ ...f.deps, sessions, participants }, { ...f.request, body: { contactIds: ["contact1"] } })).status).toBe(409);
    expect((await handleExtendSalesParticipants({ ...f.deps, sessions, provider: createClient, commands: createInMemorySalesParticipantExtensionCommandStore() }, { ...f.request, body: { commandId: f.request.body.commandId, selection: { mode: "all" } } })).status).toBe(409);
    expect(f.environments.extendById).not.toHaveBeenCalled(); expect(createClient).not.toHaveBeenCalled();
  });
  it("retries only a durably unattempted peer while an ambiguous archive and End PUT remain fenced", async () => {
    const f = fixture();
    const local = (await f.deps.participants.list("c1", "s1"))[0]!;
    vi.mocked(f.deps.participants.list).mockResolvedValue([local, { ...local, id: "p2", opportunityContactId: "contact2", cloudShareParticipantId: "remote2" }]);
    const contact = (await f.deps.records.findContact("c1", "contact1"))!;
    vi.mocked(f.deps.records.findContact).mockImplementation(async (_customer, id) => ({ ...contact, id, email: id === "contact1" ? "ada@example.test" : "grace@example.test" }));
    const roster = await f.delivery.listParticipants("experience1");
    vi.mocked(f.delivery.listParticipants).mockResolvedValue({ ...roster, completeness: "complete", provenance: { expectedCount: 2, returnedCount: 2, offsets: [0] }, participants: [...roster.participants, { ...roster.participants[0]!, id: "remote2", email: "grace@example.test", customProperties: { certalisSalesParticipantId: "p2", certalisOpportunityContactId: "contact2" } }] });
    let graceReads = 0, graceArchived = false;
    vi.mocked(f.environments.observe).mockImplementation(async ({ ownerEmail }) => {
      if (ownerEmail === "grace@example.test" && ++graceReads === 2) throw new Error("preflight unavailable");
      return { environmentId: ownerEmail === "ada@example.test" ? "opaque/v3+id" : "opaque2", statusCode: 2, expirationTime: "2026-09-20T10:00:00Z", exchanges: [exchange] };
    });
    vi.mocked(f.controller.archiveEnvironment).mockImplementation(async id => {
      if (id === "opaque/v3+id") throw new Error("ambiguous archive");
      graceArchived = true;
      return { attemptedOperation: "archive_environment", integrationSurface: "cloudshare.v3", externalIds: { environmentId: id }, method: "PUT", path: "/envs/actions/archive", request: exchange.request, response: exchange.response };
    });
    vi.mocked(f.environments.observeById).mockImplementation(async id => ({ environmentId: id, statusCode: id === "opaque2" && graceArchived ? 4 : 2, expirationTime: "2026-09-20T10:00:00Z", exchanges: [exchange] }));
    vi.mocked(f.delivery.updateSession).mockImplementation(async (_id, _changes, beforeDispatch) => { await beforeDispatch?.(); throw new Error("ambiguous end PUT"); });
    expect(await handleCancelSalesDemoSession(f.deps, f.request)).toMatchObject({ status: 202, body: { targets: [{ outcome: "dispatched", retryable: false }, { outcome: "not_dispatched", retryable: true }] } });
    expect(await handleCancelSalesDemoSession(f.deps, { ...f.request, body: { ...f.request.body, retrySafe: true } })).toMatchObject({ status: 202, body: { targets: [{ outcome: "dispatched" }, { outcome: "archived" }] } });
    expect(vi.mocked(f.controller.archiveEnvironment).mock.calls.map(([id]) => id)).toEqual(["opaque/v3+id", "opaque2"]);
    expect(f.delivery.updateSession).toHaveBeenCalledTimes(1);
  });
  it.each(["confirmation", "customer", "experience", "unbound roster", "contact", "incomplete roster", "deleted"])("fails closed before any mutation for invalid %s", async scenario => {
    const f = fixture();
    let request: Parameters<typeof handleCancelSalesDemoSession>[1] = f.request;
    if (scenario === "confirmation") request = { ...f.request, body: { ...f.request.body, confirmed: false } };
    if (scenario === "customer") request = { ...f.request, customerId: "other" };
    if (scenario === "experience") vi.mocked(f.delivery.readSession).mockResolvedValue({ id: "other", status: "inProgress", ...exchange });
    if (scenario === "contact") vi.mocked(f.deps.records.findContact).mockResolvedValue(null);
    if (scenario === "unbound roster") { const roster = await f.delivery.listParticipants("experience1"); vi.mocked(f.delivery.listParticipants).mockResolvedValue({ ...roster, participants: roster.participants.map(p => ({ ...p, customProperties: {} })) }); }
    if (scenario === "incomplete roster") vi.mocked(f.delivery.listParticipants).mockResolvedValue({ completeness: "incomplete", provenance: { expectedCount: null, returnedCount: 0, offsets: [0], reason: "count_missing" }, participants: [], ...exchange });
    if (scenario === "deleted") vi.mocked(f.environments.observe).mockResolvedValue({ environmentId: "opaque/v3+id", statusCode: 5, expirationTime: "2026-09-20T10:00:00Z", exchanges: [exchange] });
    expect((await handleCancelSalesDemoSession(f.deps, request)).status).toBeGreaterThanOrEqual(400);
    expect(f.controller.archiveEnvironment).not.toHaveBeenCalled();
    expect(f.delivery.updateSession).not.toHaveBeenCalled();
  });
  it("cancels a never-launched scheduled participant only with explicit absent-environment evidence", async () => {
    const f = fixture();
    const local = await f.deps.participants.list("c1", "s1");
    vi.mocked(f.deps.participants.list).mockResolvedValue(local.map(p => ({ ...p, participationStatus: "pending", firstJoined: null })));
    const roster = await f.delivery.listParticipants("experience1");
    vi.mocked(f.delivery.listParticipants).mockResolvedValue({ ...roster, participants: roster.participants.map(p => ({ ...p, participationStatus: "pending", firstJoined: null, environmentId: null, envStatus: null })) });
    vi.mocked(f.environments.observe).mockRejectedValue(new SalesEnvironmentResolutionError("environment_not_found_for_project", [exchange]));
    expect(await handleCancelSalesDemoSession(f.deps, f.request)).toMatchObject({ status: 200, body: { targets: [{ outcome: "no_environment" }] } });
    expect(f.controller.archiveEnvironment).not.toHaveBeenCalled();
  });
  it("archives first, then ends and labels the retained Experience at the stable cancellation time", async () => {
    const f = fixture();
    const result = await handleCancelSalesDemoSession(f.deps, f.request);
    expect(result).toMatchObject({ status: 200, body: { status: "Cancelled", cancelledAt: "2026-09-19T10:00:00.000Z", accessConfirmed: true } });
    expect(f.delivery.updateSession).toHaveBeenCalledWith("experience1", { end: "2026-09-19T10:00", cancelled: true }, expect.any(Function));
    expect(vi.mocked(f.controller.archiveEnvironment).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(f.delivery.updateSession).mock.invocationCallOrder[0]!);
    expect(f.deps.sessions.updateEnd).toHaveBeenCalledWith("c1", "s1", "2026-09-19T10:00");
    expect((await f.deps.commands.latest("c1", "s1"))?.actor).toEqual({ type: "admin", id: "actor1" });
    expect(await f.deps.participants.list("c1", "s1")).toHaveLength(1);
  });
  it("persists exact opaque binding before archive and never replays an ambiguous dispatch", async () => {
    const f = fixture();
    vi.mocked(f.controller.archiveEnvironment).mockImplementation(async id => {
      expect((await f.deps.commands.read("c1", f.request.body.commandId))?.targets).toMatchObject([{ environmentId: id, state: "dispatched" }]);
      throw new Error("provider transport ambiguity");
    });
    expect(await handleCancelSalesDemoSession(f.deps, f.request)).toMatchObject({ status: 202 });
    expect(f.controller.archiveEnvironment).toHaveBeenCalledTimes(1);
    expect(f.controller.archiveEnvironment).toHaveBeenCalledWith("opaque/v3+id");
    f.setArchived();
    await handleCancelSalesDemoSession(f.deps, { ...f.request, body: { ...f.request.body, reconcile: true } });
    expect(f.controller.archiveEnvironment).toHaveBeenCalledTimes(1);
    expect(f.environments.observeById).toHaveBeenLastCalledWith("opaque/v3+id");
  });
});


