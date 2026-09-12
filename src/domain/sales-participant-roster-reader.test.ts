import { describe, expect, it, vi } from "vitest";
import { createSalesParticipantRosterReader } from "./sales-participant-roster-reader";

describe("sales participant roster reader", () => {
  it("owns route construction and retry as GET-only reads", async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => new Response(JSON.stringify({ url }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const reader = createSalesParticipantRosterReader<{ url: string }>({ fetch, route: (id) => `/workspace/${id}`, decode: async (response) => await response.json() as { url: string } });
    await reader.read({ sessionId: "s 1", query: "Ada Lovelace", page: 2, pageSize: 25 });
    await reader.retry();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[0]).toBe("/workspace/s%201?participantQuery=Ada+Lovelace&participantPage=2&participantPageSize=25");
    expect(fetch.mock.calls.every(([, init]) => init.method === undefined)).toBe(true);
  });

  it("keeps the last safe roster when a later read fails", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ value: "safe" }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ error: "down" }), { status: 503 }));
    const reader = createSalesParticipantRosterReader<{ value?: string; error?: string }>({ fetch, route: () => "/workspace", decode: async (response) => await response.json() });
    expect((await reader.read({ sessionId: "s", query: "", page: 0, pageSize: 25 })).ok).toBe(true);
    const failed = await reader.retry();
    expect(failed.ok).toBe(false);
    expect(failed.ok ? undefined : failed.lastSafe).toEqual({ value: "safe" });
  });
});
