import { describe, expect, it, vi } from "vitest";
import { handleCancelSalesDemoSession, type SalesCancellationDependencies } from "./sales-demo-session-cancellation";
import { createInMemorySalesCancellationStore } from "@/persistence/in-memory-sales-session-cancellation";
import type { SalesEnvironmentSource } from "@/integrations/cloudshare/sales-environment";
import type { EnvironmentController } from "@/domain/environment";
const exchange = { request: { method: "GET" as const, path: "/fixture" }, response: { status: 200, body: null } };
function fixture() {
  const now = new Date("2026-09-19T10:00:00Z");
  const commands = createInMemorySalesCancellationStore();
  let end = "2026-09-20T10:00", archived = false;
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
    readSession: vi.fn<ReturnType<SalesCancellationDependencies["provider"]>["delivery"]["readSession"]>(async () => ({ id: "experience1", status: "inProgress", end, ...exchange })),
    listParticipants: vi.fn<ReturnType<SalesCancellationDependencies["provider"]>["delivery"]["listParticipants"]>(async () => ({ completeness: "complete", provenance: { expectedCount: 1, returnedCount: 1, offsets: [0] }, participants: [{ id: "remote1", email: "ada@example.test", firstName: "Ada", lastName: "Example", invitationStatus: "notSent", invitedBy: null, firstJoined: null, participationStatus: "inProgress", envStatus: "Ready", environmentId: "17", customProperties: { certalisSalesParticipantId: "p1", certalisOpportunityContactId: "contact1" } }], ...exchange })),
    updateSession: vi.fn<ReturnType<SalesCancellationDependencies["provider"]>["delivery"]["updateSession"]>(async (id, changes) => { end = changes.end!; return { id, ...exchange }; }),
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


