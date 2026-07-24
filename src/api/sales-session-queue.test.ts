import { describe, expect, it, vi } from "vitest";
import { handleReadSalesSessionQueue } from "./sales-session-queue";

const session = { id: "session-1", customerId: "customer-a", accountId: "account-1", accountName: "Acme", opportunityId: "opp-1", opportunityName: "Renewal", itemId: "item-1", cloudShareSalesExperienceId: "server-only", externalId: "opaque", type: "demo" as const, start: "2026-07-25T09:00", end: "2026-07-25T10:00", timeZone: "UTC", salesProEmail: "sales@example.test", salesProDisplayName: "Sales", registrationType: "registeredParticipantsOnly" as const, sendInvitations: "dontSend" as const, sessionName: "Acme renewal", revision: 2, experienceStatus: "notStarted" as const, experienceStatusObservedAt: new Date("2026-07-23T09:58:00Z"), createdAt: new Date("2026-07-20T00:00:00Z") };

describe("Sales Session queue handler", () => {
  it("uses a bounded Customer-scoped query and returns an explained safe restoration state", async () => {
    const read = vi.fn().mockResolvedValue({ rows: [session], total: 1 });
    const findTarget = vi.fn().mockResolvedValue({ id: "not-on-page", archived: false });
    const result = await handleReadSalesSessionQueue({ queue: { read, findTarget }, now: () => new Date("2026-07-23T10:00:00Z") }, { customerId: "customer-a", query: { view: "active", accountId: "account-1", search: "Acme", sort: "name_asc", offset: "25", limit: "25", target: "not-on-page" } });
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer-a", view: "active", accountId: "account-1", search: "Acme", sort: "name_asc", offset: 25, limit: 25 }));
    expect(result).toMatchObject({ status: 200, body: { rows: [{ id: "session-1", experience: { value: "notStarted" } }], target: { state: "outside_current_queue" } } });
    expect(JSON.stringify(result.body)).not.toContain("server-only");
  });

  it("accepts old bookmarked queue values but publishes the new view vocabulary", async () => {
    const read = vi.fn().mockResolvedValue({ rows: [{ ...session, experienceStatus: "ended" }], total: 1 });
    const result = await handleReadSalesSessionQueue({ queue: { read, findTarget: vi.fn() }, now: () => new Date("2026-07-23T10:00:00Z") }, { customerId: "customer-a", query: { view: "ended" } });
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ view: "history", limit: 25 }));
    expect(result.body).toMatchObject({ view: "history", rows: [{ id: "session-1" }] });
  });
});

it("fails an archived restoration target closed even when its id appears on the page", async () => {
  const candidate = { ...session, id: "archived-session" };
  const queue = {
    read: vi.fn().mockResolvedValue({ total: 1, rows: [candidate] }),
    findTarget: vi.fn().mockResolvedValue({ id: "archived-session", archived: true }),
  };
  const result = await handleReadSalesSessionQueue({ queue, now: () => new Date("2026-07-23T10:00:00Z") }, { customerId: "customer-a", query: { target: "archived-session" } });
  expect(result).toMatchObject({ status: 200, body: { target: { state: "archived" } } });
});
