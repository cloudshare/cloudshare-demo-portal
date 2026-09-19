import { describe, expect, it, vi } from "vitest";
import { handleExtendSalesParticipants, type SalesParticipantExtensionDependencies } from "./sales-participant-extension";
import { createInMemorySalesParticipantExtensionCommandStore } from "@/persistence/in-memory-sales-participant-extension-command";
const exchange = { request: { method: "GET" as const, path: "/fixture" }, response: { status: 200 } };
function fixture() {
  let expiry = "2026-09-20T10:00:00Z", end = "2026-09-20T09:00";
  const order: string[] = [];
  const participant = { id: "p1", customerId: "c1", salesDemoSessionId: "s1", opportunityContactId: "contact1", cloudShareParticipantId: "remote1", participationStatus: "inProgress", updatedAt: new Date("2026-09-19T01:00:00Z") };
  const environments = { observe: vi.fn(async (_input: { ownerEmail: string; projectId: string }) => ({ environmentId: "opaque1", statusCode: 2 as const, expirationTime: expiry, exchanges: [exchange] })), observeById: vi.fn(async (_id: string) => { order.push("read-expiry"); return { environmentId: "opaque1", statusCode: 2 as const, expirationTime: expiry, exchanges: [exchange] }; }), extendById: vi.fn(async (_id: string) => { order.push("extend"); expiry = "2026-09-21T10:00:00Z"; return { environmentId: "opaque1", exchange }; }) };
  const delivery = { readSession: vi.fn(async () => ({ id: "experience1", status: "inProgress" as const, end, ...exchange })), listParticipants: vi.fn(async () => ({ participants: [{ id: "remote1", email: "ada@example.com", participationStatus: "inProgress", envStatus: "Ready", environmentId: "numeric-roster-reference", customProperties: { certalisSalesParticipantId: "p1", certalisOpportunityContactId: "contact1" } }], completeness: "complete", ...exchange })), updateSession: vi.fn(async (_id, changes) => { order.push("update-end"); end = changes.end; return { id: "experience1", ...exchange }; }) };
  const deps = { commands: createInMemorySalesParticipantExtensionCommandStore(), sessions: { findById: vi.fn(async (customerId) => customerId === "c1" ? { id: "s1", customerId: "c1", itemId: "item1", opportunityId: "op1", cloudShareSalesExperienceId: "experience1", end, timeZone: "UTC", operationalStatus: "active" } : null), updateEnd: vi.fn(async () => {}) }, items: { findById: vi.fn(async () => ({ customerId: "c1", project: { id: "project1" } })) }, records: { findContact: vi.fn(async () => ({ id: "contact1", customerId: "c1", opportunityId: "op1", email: "ada@example.com", archivedAt: null })) }, participants: { list: vi.fn(async () => [participant]) }, connections: { findByCustomerId: vi.fn(async () => ({ customerId: "c1" })) }, provider: () => ({ delivery, environments }), diagnostics: { record: vi.fn(async () => {}) }, audit: { write: vi.fn(async () => {}) }, now: () => new Date("2026-09-19T08:00:00Z") } as unknown as SalesParticipantExtensionDependencies;
  const request = { customerId: "c1", sessionId: "s1", actor: { type: "admin", id: "admin" }, body: { commandId: "9bc409ad-9217-4943-8e1d-e18a0ddbbf54", selection: { mode: "all", excludedIds: [] } } };
  return { deps, request, order, environments, delivery, setExpiry: (value: string) => { expiry = value; } };
}
describe("Sales Participant extension HTTP seam", () => {
  it("retries only an unattempted target while its peer remains ambiguous, preserving partial access", async () => {
    const f = fixture();
    const first = (await f.deps.participants.list("c1", "s1"))[0]!;
    vi.mocked(f.deps.participants.list).mockResolvedValue([first, { ...first, id: "p2", opportunityContactId: "contact2", cloudShareParticipantId: "remote2" }]);
    const contact = await f.deps.records.findContact("c1", "contact1");
    vi.mocked(f.deps.records.findContact).mockImplementation(async (_customer, id) => ({ ...contact!, id, email: id === "contact1" ? "ada@example.com" : "grace@example.com" }));
    const roster = await f.delivery.listParticipants();
    f.delivery.listParticipants.mockResolvedValue({ ...roster, participants: [...roster.participants, { ...roster.participants[0]!, id: "remote2", email: "grace@example.com", customProperties: { certalisSalesParticipantId: "p2", certalisOpportunityContactId: "contact2" } }] });
    let secondReads = 0, secondExpiry = "2026-09-20T10:00:00Z";
    f.environments.observe.mockImplementation(async ({ ownerEmail }: { ownerEmail: string }) => {
      if (ownerEmail === "grace@example.com" && ++secondReads === 2) throw new Error("preflight unavailable");
      return { environmentId: ownerEmail === "ada@example.com" ? "opaque1" : "opaque2", statusCode: 2 as const, expirationTime: ownerEmail === "ada@example.com" ? "2026-09-20T10:00:00Z" : secondExpiry, exchanges: [exchange] };
    });
    f.environments.extendById.mockImplementation(async (id: string) => { if (id === "opaque1") throw new Error("timeout"); secondExpiry = "2026-09-21T10:00:00Z"; return { environmentId: id, exchange }; });
    f.environments.observeById.mockImplementation(async (id: string) => ({ environmentId: id, statusCode: 2 as const, expirationTime: id === "opaque1" ? "2026-09-20T10:00:00Z" : secondExpiry, exchanges: [exchange] }));
    expect(await handleExtendSalesParticipants(f.deps, f.request)).toMatchObject({ body: { finished: false, targets: [{ outcome: "needs_attention", retryable: false }, { outcome: "failed_retryable", retryable: true }] } });
    expect(await handleExtendSalesParticipants(f.deps, { ...f.request, body: { ...f.request.body, retrySafe: true } })).toMatchObject({ body: { outcome: "needs_attention", accessConfirmed: true, targets: [{ outcome: "needs_attention" }, { outcome: "confirmed" }] } });
    expect(f.environments.extendById.mock.calls.map(call => call[0])).toEqual(["opaque1", "opaque2"]);
  });
  it("retains ambiguity across a fresh command and only reconciles with GET", async () => {
    const f = fixture();
    f.environments.extendById.mockImplementationOnce(async () => { throw new Error("lost acknowledgement"); });
    expect(await handleExtendSalesParticipants(f.deps, f.request)).toMatchObject({ status: 202, body: { outcome: "needs_attention", targets: [{ outcome: "needs_attention", retryable: false }] } });
    const fresh = { ...f.request, body: { ...f.request.body, commandId: "aec409ad-9217-4943-8e1d-e18a0ddbbf54" } };
    expect(await handleExtendSalesParticipants(f.deps, fresh)).toMatchObject({ status: 409 });
    f.setExpiry("2026-09-21T10:00:00Z");
    expect(await handleExtendSalesParticipants(f.deps, { ...f.request, body: { ...f.request.body, reconcile: true } })).toMatchObject({ status: 200, body: { outcome: "completed" } });
    expect(f.environments.extendById).toHaveBeenCalledTimes(1);
  });
  it("rejects another Customer and duplicate correlation without dispatch", async () => {
    const f = fixture();
    expect(await handleExtendSalesParticipants(f.deps, { ...f.request, customerId: "c2" })).toMatchObject({ status: 404 });
    const roster = await f.delivery.listParticipants();
    f.delivery.listParticipants.mockResolvedValue({ ...roster, participants: [...roster.participants, { ...roster.participants[0]!, id: "duplicate" }] });
    expect(await handleExtendSalesParticipants(f.deps, f.request)).toMatchObject({ status: 502 });
    expect(f.environments.extendById).not.toHaveBeenCalled();
  });
  it("accepts the live v3 RFC1123 GMT expiry without host-timezone inference", async () => {
    const f = fixture();
    f.setExpiry("Sun, 20 Sep 2026 10:00:00 GMT");
    expect(await handleExtendSalesParticipants(f.deps, f.request)).toMatchObject({ status: 200 });
  });
  it("honours narrowed default-all selection", async () => {
    const f = fixture();
    expect(await handleExtendSalesParticipants(f.deps, { ...f.request, body: { ...f.request.body, selection: { mode: "all", excludedIds: ["p1"] } } })).toMatchObject({ status: 409 });
    expect(f.environments.extendById).not.toHaveBeenCalled();
  });
  it("does not replay an ambiguous Sales Experience PUT", async () => {
    const f = fixture();
    f.delivery.updateSession.mockImplementationOnce(async () => { throw new Error("timeout"); });
    expect(await handleExtendSalesParticipants(f.deps, f.request)).toMatchObject({ status: 202, body: { accessConfirmed: false } });
    await handleExtendSalesParticipants(f.deps, { ...f.request, body: { ...f.request.body, reconcile: true } });
    expect(f.environments.extendById).toHaveBeenCalledTimes(1);
    expect(f.delivery.updateSession).toHaveBeenCalledTimes(1);
  });
  it("extends the exact resolved environment, reconciles expiry before End, and never replays", async () => {
    const f = fixture();
    expect(await handleExtendSalesParticipants(f.deps, f.request)).toMatchObject({ status: 200, body: { outcome: "completed", targets: [{ participantId: "p1", outcome: "confirmed", confirmedExpiry: "2026-09-21T10:00:00.000Z" }] } });
    expect(f.order).toEqual(["extend", "read-expiry", "update-end"]);
    expect(f.environments.extendById).toHaveBeenCalledWith("opaque1");
    await handleExtendSalesParticipants(f.deps, f.request);
    expect(f.environments.extendById).toHaveBeenCalledTimes(1);
    expect(f.delivery.updateSession).toHaveBeenCalledTimes(1);
  });
});
