import { describe, expect, it, vi } from "vitest";
import { createCloudShareSalesEnvironmentModule, createSalesEnvironmentModule } from "./environment-observation";
import { createCloudShareEnvironmentSource } from "./environment";
import { SalesEnvironmentResolutionError } from "./sales-environment";
import type { CloudShareClient } from "./client";

function clientFor(data: unknown): CloudShareClient {
  return { requestV3: vi.fn(async ({ schema }) => schema.parse(data)) } as unknown as CloudShareClient;
}

describe("semantic Sales environment reads", () => {
  it("normalizes an authoritative retained Preparing environment without changing its evidence", async () => {
    const response = { status: 200, body: { statusCode: 8, expirationTime: "Tue, 01 Sep 2026 11:10:59 GMT", accessLink: "protected" } };
    const source = createCloudShareSalesEnvironmentModule({ requestV3Detailed: vi.fn(async () => ({
      data: response.body, request: { method: "GET", path: "/envs/actions/getextended" }, response,
    })) } as never);
    const observed = await source.observeById("retained-id");
    expect(observed).toMatchObject({ environmentId: "retained-id", state: "preparing", persistedStatus: "Preparing",
      expiry: { session: new Date("2026-09-01T11:10:59Z"), trial: new Date("2026-09-01T11:10:59Z") },
      exchanges: [{ response }],
    });
  });

  it.each([
    [2, "ready", "Ready"], [3, "suspended", "Suspended"], [4, "archived", "Archived"],
    [5, "deleted", "Deleted"], [7, "taking_snapshot", null], [8, "preparing", "Preparing"], [9, "creation_failed", "CreationFailed"],
  ])("keeps Sales code %s distinct from Certification numeric-only observations", async (statusCode, state, persistedStatus) => {
    const client = clientFor({ statusCode, expirationTime: "2026-09-01T11:10:59Z" });
    await expect(createCloudShareSalesEnvironmentModule(client).observeById("id")).resolves.toMatchObject({ state, persistedStatus });
    await expect(createCloudShareEnvironmentSource(client).getEnvironmentState("id")).resolves.toMatchObject({ status: "unknown", statusCode });
  });

  it.each([
    ["2026-09-01T12:10:59+01:00", "2026-09-01T11:10:59.000Z", "2026-09-01T11:10:59.000Z"],
    ["Tue, 01 Sep 2026 11:10:59 GMT", "2026-09-01T11:10:59.000Z", "2026-09-01T11:10:59.000Z"],
    ["2026-09-01", null, "2026-09-01T00:00:00.000Z"],
    ["not-a-date", null, null],
  ])("preserves separate expiry acceptance for %s", async (expirationTime, session, trial) => {
    const observed = await createCloudShareSalesEnvironmentModule(clientFor({ statusCode: 2, expirationTime })).observeById("id");
    expect(observed.expiry.session?.toISOString() ?? null).toBe(session);
    expect(observed.expiry.trial?.toISOString() ?? null).toBe(trial);
    expect(observed.expiry.raw).toBe(expirationTime);
  });

  it.each([{}, { statusCode: 6 }, { statusCode: "Ready" }, { statusCode: 2, expirationTime: "" }])("preserves malformed/missing Sales read rejection: %j", async (payload) => {
    await expect(createCloudShareSalesEnvironmentModule(clientFor(payload)).observeById("id")).rejects.toThrow();
  });

  it.each([{}, { statusCode: "2" }, { envStatus: "" }])("rejects missing/malformed Certification state: %j", async payload => {
    await expect(createCloudShareEnvironmentSource(clientFor(payload)).getEnvironmentState("id")).rejects.toThrow();
  });

  it.each(["Taking a Snapshot", "Creation Failed", "future-state"])("keeps Certification string %s unknown", async envStatus => {
    await expect(createCloudShareEnvironmentSource(clientFor({ envStatus })).getEnvironmentState("id")).resolves.toMatchObject({ status: "unknown" });
  });

  it("keeps unknown injected observations unknown without guessing readiness", async () => {
    const source = createSalesEnvironmentModule({ observe: async () => ({ environmentId: "id", statusCode: 99, expirationTime: "bad", exchanges: [] }) });
    await expect(source.observe({ ownerEmail: "owner", projectId: "project" })).resolves.toMatchObject({ state: "unknown", persistedStatus: null, expiry: { session: null, trial: null } });
  });

  it.each([[], [{ id: "one", projectId: "project" }, { id: "two", projectId: "project" }]])("rejects non-unique owner/Project resolution before a second read", async (...items) => {
    const requestV3 = vi.fn(async ({ schema }) => schema.parse(items));
    const source = createCloudShareSalesEnvironmentModule({ requestV3 } as unknown as CloudShareClient);
    await expect(source.observe({ ownerEmail: "owner@example.test", projectId: "project" })).rejects.toBeInstanceOf(SalesEnvironmentResolutionError);
    expect(requestV3).toHaveBeenCalledTimes(1);
  });

  it.each(["", "accepted"])("retains Sales text-only extension evidence for %j", async (body) => {
    const requestV3Text = vi.fn(async () => body);
    const source = createCloudShareSalesEnvironmentModule({ requestV3Text } as unknown as CloudShareClient);
    await expect(source.extendById("captured-id")).resolves.toEqual({ environmentId: "captured-id", exchange: {
      request: { method: "PUT", path: "/api/v3/envs/actions/extend", query: { envId: "captured-id" } },
      response: { status: 200, body: undefined },
    } });
    expect(requestV3Text).toHaveBeenCalledWith({ method: "PUT", path: "/envs/actions/extend", query: { envId: "captured-id" } });
  });
});
