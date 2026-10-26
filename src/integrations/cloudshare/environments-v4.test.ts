import { describe, expect, it } from "vitest";
import { createCloudShareClient, createCloudShareNoopRequestObserver } from "./client";
import type { HttpRequest } from "./http";
import { createCloudShareSalesEnvironmentModule } from "./environment-observation";
export const environment = { id: "ENVS-opaque", projectId: "PR-exact", ownerEmail: "owner@example.test", status: "ready", startTime: "Tue, 01 Sep 2026 10:00:00 GMT", expirationTime: "Wed, 02 Sep 2026 10:00:00 GMT" };
export function recordingClient(pages: unknown[], statuses: number[] = []) {
  const requests: HttpRequest[] = [];
  const client = createCloudShareClient({ endpoints: { v4BaseUrl: "https://api.accelerate.cloudshare.com/v4", v3BaseUrl: "https://use.cloudshare.com/api/v3" }, v3: { apiId: "test", apiKey: "test" }, tokenProvider: { getToken: async () => "test-token" }, observer: createCloudShareNoopRequestObserver(), http: { send: async request => { requests.push(request); return { status: statuses.shift() ?? 200, body: JSON.stringify(pages.shift()) }; } } });
  return { client, requests };
}
describe("v4 Environment observation", () => {
  it("resolves after all pages and exact normalized owner plus Project filtering", async () => {
    const first = { count: 3, items: [{ ...environment, id: "substring", ownerEmail: "other-owner@example.test" }, { ...environment, id: "wrong-project", projectId: "other" }] };
    const second = { count: 3, items: [environment] };
    const { client, requests } = recordingClient([first, second, environment]);
    const observed = await createCloudShareSalesEnvironmentModule(client).observe({ ownerEmail: " OWNER@example.test ", projectId: "PR-exact" });
    expect(observed).toMatchObject({ environmentId: "ENVS-opaque", state: "ready", expiry: { session: new Date("2026-09-02T10:00:00Z") }, exchanges: [{ response: { body: first } }, { response: { body: second } }, { response: { body: environment } }] });
    expect(requests.map(r => r.url)).toEqual(["https://api.accelerate.cloudshare.com/v4/environments?OwnerEmail=owner%40example.test&Count=true&Offset=0&Limit=100", "https://api.accelerate.cloudshare.com/v4/environments?OwnerEmail=owner%40example.test&Count=true&Offset=2&Limit=100", "https://api.accelerate.cloudshare.com/v4/environments/ENVS-opaque"]);
  });
});
import { createCloudShareEnvironmentSource } from "./environment";
import { inspectCloudShareEnvironmentLease } from "./external-lease";
it("Certification and lease use exact v4 identity and unknown never grants an active lease", async () => {
  const { client, requests } = recordingClient([{ ...environment, status: "stopping" }, { ...environment, status: "stopping" }]);
  expect(await createCloudShareEnvironmentSource(client).getEnvironmentState(environment.id)).toMatchObject({ status: "unknown" });
  expect(await inspectCloudShareEnvironmentLease(client, environment.id)).toMatchObject({ kind: "unknown", integrationSurface: "cloudshare.v4" });
  expect(requests.every(r => r.url.endsWith("/v4/environments/ENVS-opaque"))).toBe(true);
});
it.each([
  ["ready", "ready", "running", "active"], ["suspended", "suspended", "suspended", "active"], ["preparing", "preparing", "created", "active"],
  ["publishing", "publishing", "unknown", "unknown"], ["archived", "archived", "archived", "expired"], ["deleted", "deleted", "deleted", "expired"],
  ["creationFailed", "creation_failed", "unknown", "unknown"], ["inGrace", "inGrace", "unknown", "unknown"], ["futureAllocationScheduled", "futureAllocationScheduled", "unknown", "unknown"],
  ["allocationScheduledNoRun", "allocationScheduledNoRun", "unknown", "unknown"], ["editingNetworks", "editingNetworks", "unknown", "unknown"], ["stopping", "stopping", "unknown", "unknown"], ["unknown", "unknown", "unknown", "unknown"], ["future-new-state", "unknown", "unknown", "unknown"],
])("normalizes %s without granting transitional command eligibility", async (status, sales, certification, lease) => {
  const payload = { ...environment, status };
  const { client } = recordingClient([payload, payload, payload]);
  expect(await createCloudShareSalesEnvironmentModule(client).observeById(environment.id)).toMatchObject({ state: sales, source: "cloudshare_v4_environment" });
  expect(await createCloudShareEnvironmentSource(client).getEnvironmentState(environment.id)).toMatchObject({ status: certification, source: "cloudshare_v4_environment" });
  expect(await inspectCloudShareEnvironmentLease(client, environment.id)).toMatchObject({ kind: lease });
});
it.each(["id", "projectId", "ownerEmail"])("rejects changed detail %s after exact list resolution", async key => {
  const { client } = recordingClient([{ count: 1, items: [environment] }, { ...environment, [key]: "different" }]);
  await expect(createCloudShareSalesEnvironmentModule(client).observe({ ownerEmail: environment.ownerEmail, projectId: environment.projectId })).rejects.toMatchObject({ name: "CloudShareResponseError" });
});
it.each([[], [environment, { ...environment, id: "ENVS-second" }]])("rejects zero/multiple matches", async (...items) => {
  const { client } = recordingClient([{ count: items.length, items }]);
  await expect(createCloudShareSalesEnvironmentModule(client).observe({ ownerEmail: environment.ownerEmail, projectId: environment.projectId })).rejects.toMatchObject({ name: "SalesEnvironmentResolutionError" });
});
it.each([403, 500, 429])("does not turn HTTP %s into absence or an active lease", async status => {
  const { client } = recordingClient([{}], [status]);
  expect(await inspectCloudShareEnvironmentLease(client, environment.id)).toMatchObject({ kind: "unknown" });
});
it("keeps a 404 distinct from permission and malformed responses", async () => {
  const { client } = recordingClient([{}, {}], [404, 404]);
  expect(await createCloudShareEnvironmentSource(client).getEnvironmentState(environment.id)).toBeNull();
  expect(await inspectCloudShareEnvironmentLease(client, environment.id)).toMatchObject({ kind: "expired", reason: "not_found" });
});
it.each(["not-a-date", "2026-09-02", "2026-09-02T10:00:00Z"])("rejects non-contract v4 UTC dates: %s", async expirationTime => {
  const { client } = recordingClient([{ ...environment, expirationTime }]);
  await expect(createCloudShareSalesEnvironmentModule(client).observeById(environment.id)).rejects.toMatchObject({ name: "CloudShareResponseError" });
});
it("preserves completed page exchanges when a later page fails", async () => {
 const first = { count: 2, items: [environment], secret: "protected" };
 const { client } = recordingClient([first, {}], [200, 403]);
 await expect(createCloudShareSalesEnvironmentModule(client).observe({ ownerEmail: environment.ownerEmail, projectId: environment.projectId })).rejects.toMatchObject({ exchanges: [{ response: { body: first } }] });
});
