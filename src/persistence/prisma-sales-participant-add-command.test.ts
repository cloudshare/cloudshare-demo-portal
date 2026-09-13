import { describe, expect, it, vi } from "vitest";
import { createPrismaSalesParticipantAddCommandStore } from "./prisma-sales-participant-add-command";
import type { SalesParticipantWorkspaceAddParticipantResult } from "@/domain/sales-participant-workspace";

function fakePrisma() {
  const rows = new Map<string, any>();
  const key = (x: any) => `${x.customerId ?? x.customerId_commandId.customerId}:${x.commandId ?? x.customerId_commandId.commandId}`;
  return { salesParticipantAddCommand: {
    findUnique: vi.fn(async ({ where }: any) => rows.get(key(where.customerId_commandId)) ?? null),
    findUniqueOrThrow: vi.fn(async ({ where }: any) => rows.get(key(where.customerId_commandId))),
    create: vi.fn(async ({ data }: any) => { const k = key(data); if (rows.has(k)) throw new Error("unique"); rows.set(k, data); return data; }),
    updateMany: vi.fn(async ({ where, data }: any) => { const row = rows.get(key(where)); if (!row || (where.state && row.state !== where.state)) return { count: 0 }; Object.assign(row, data); return { count: 1 }; }),
    update: vi.fn(async ({ where, data }: any) => { const row = rows.get(key(where)); Object.assign(row, data); return row; }),
  } } as any;
}
const ok: SalesParticipantWorkspaceAddParticipantResult = { status: 201, body: { outcome: "registered", participantId: "p", contactId: "c", correlationId: "safe" } };
describe("Sales Participant add command fence", () => {
  it("admits the same command concurrently only once", async () => { const p = fakePrisma(); const s = createPrismaSalesParticipantAddCommandStore(p); const input = { customerId: "a", sessionId: "s", commandId: "cmd", payloadHash: "payload", now: new Date() }; const results = await Promise.all([s.admit(input), s.admit(input)]); expect(results.filter(x => x.kind === "new")).toHaveLength(1); });
  it("returns settled controlled result and rejects payload mismatch", async () => { const p = fakePrisma(); const s = createPrismaSalesParticipantAddCommandStore(p); const input = { customerId: "a", sessionId: "s", commandId: "cmd", payloadHash: "payload", now: new Date() }; await s.admit(input); await s.markDispatched(input); await s.settle({ ...input, state: "settled", result: ok }); expect((await s.admit(input)).result).toEqual(ok); expect((await s.admit({ ...input, payloadHash: "other" })).kind).toBe("mismatch"); expect(JSON.stringify(p.salesParticipantAddCommand)).not.toContain("cloud"); });
  it("keeps ambiguous post-dispatch outcomes non-replayable", async () => { const p = fakePrisma(); const s = createPrismaSalesParticipantAddCommandStore(p); const input = { customerId: "a", sessionId: "s", commandId: "cmd", payloadHash: "payload", now: new Date() }; await s.admit(input); await s.markDispatched(input); const attention = { status: 409, body: { outcome: "needs_attention" as const, code: "participant_add_no_replay" } }; await s.settle({ ...input, state: "needs_attention", result: attention }); const replay = await s.admit(input); expect(replay.kind).toBe("existing"); expect(replay.state).toBe("needs_attention"); expect(replay.result).toEqual(attention); expect(p.salesParticipantAddCommand.create).toHaveBeenCalledTimes(1); });
  it("makes pre-dispatch admission failure explicit", async () => { const p = fakePrisma(); const s = createPrismaSalesParticipantAddCommandStore(p); const input = { customerId: "a", sessionId: "s", commandId: "cmd", payloadHash: "payload", now: new Date() }; await s.admit(input); expect((await s.admit(input)).state).toBe("admitted"); await s.settle({ ...input, state: "settled", result: { status: 404, body: { outcome: "rejected", code: "not_found" } } }); expect((await s.admit(input)).result?.body.code).toBe("not_found"); });
});
