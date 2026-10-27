import { expect, it } from "vitest";
import { createCloudShareClient, createCloudShareNoopRequestObserver } from "./client";
import { createCloudShareEnvironmentController } from "./environment-controller";
import type { HttpRequest } from "./http";

it.each(["suspend", "resume"] as const)("%s uses the exact opaque Environment with a bodyless v4 POST and retains empty 204 evidence", async action => {
  const requests: HttpRequest[] = [];
  const client = createCloudShareClient({
    endpoints: { v4BaseUrl: "https://api.accelerate.cloudshare.com/v4", v3BaseUrl: "https://use.cloudshare.com/api/v3" },
    v3: { apiId: "test", apiKey: "test" }, tokenProvider: { getToken: async () => "test-token" },
    observer: createCloudShareNoopRequestObserver(),
    http: { send: async request => { requests.push(request); return { status: 204, body: "" }; } },
  });
  const result = await createCloudShareEnvironmentController(client)[action === "suspend" ? "suspendEnvironment" : "resumeEnvironment"]("EN-opaque_Ab-42");
  expect(requests).toEqual([{ method: "POST", url: `https://api.accelerate.cloudshare.com/v4/environments/EN-opaque_Ab-42/${action}`, headers: { authorization: "Bearer test-token" }, body: undefined }]);
  expect(result).toMatchObject({ attemptedOperation: `${action}_environment`, integrationSurface: `cloudshare.v4.environments.${action}`, method: "POST", path: `/v4/environments/EN-opaque_Ab-42/${action}`, externalIds: { environmentId: "EN-opaque_Ab-42" }, response: { status: 204, body: "" } });
  expect(result.request).toMatchObject({ headers: { authorization: "[REDACTED]" } });
});


it.each([
  [400, '{"id":["Id has incorrect format"]}'],
  [400, '"Action is not available in the current Environment state"'],
  [401, '{"message":"Authorization invalid","token":"protected-token"}'],
  [403, ''], [404, ''], [429, '{"message":"Too many requests"}'],
  [500, '{"message":"Unexpected provider failure"}'],
] as const)("retains HTTP %s provider evidence without retrying or falling back", async (status, body) => {
  const requests: HttpRequest[] = [];
  const traces: unknown[] = [];
  const client = createCloudShareClient({
    endpoints: { v4BaseUrl: "https://api.accelerate.cloudshare.com/v4", v3BaseUrl: "https://use.cloudshare.com/api/v3" },
    v3: { apiId: "test", apiKey: "test" }, tokenProvider: { getToken: async () => "test-token" },
    observer: createCloudShareNoopRequestObserver(), trace: event => traces.push(event),
    http: { send: async request => { requests.push(request); return { status, body }; } },
  });
  await expect(createCloudShareEnvironmentController(client).resumeEnvironment("EN-opaque_Ab-42")).rejects.toMatchObject({ context: { method: "POST", path: "/v4/environments/EN-opaque_Ab-42/resume", responseBody: body ? JSON.parse(body) : "" } });
  expect(requests).toHaveLength(1);
  expect(JSON.stringify(traces)).not.toContain("protected-token");
  expect(JSON.stringify(traces)).not.toContain("EN-opaque_Ab-42");
});

it("does not replay a command whose transport outcome is unknown", async () => {
  const requests: HttpRequest[] = [];
  const client = createCloudShareClient({
    endpoints: { v4BaseUrl: "https://api.accelerate.cloudshare.com/v4", v3BaseUrl: "https://use.cloudshare.com/api/v3" },
    v3: { apiId: "test", apiKey: "test" }, tokenProvider: { getToken: async () => "test-token" }, observer: createCloudShareNoopRequestObserver(),
    http: { send: async request => { requests.push(request); throw new Error("socket closed"); } },
  });
  await expect(createCloudShareEnvironmentController(client).suspendEnvironment("EN-opaque")).rejects.toMatchObject({ name: "CloudShareTransportError" });
  expect(requests).toHaveLength(1);
});

it("keeps Archive and default Extend on their existing v3 PUT/query transports", async () => {
  const requests: HttpRequest[] = [];
  const client = createCloudShareClient({
    endpoints: { v4BaseUrl: "https://api.accelerate.cloudshare.com/v4", v3BaseUrl: "https://use.cloudshare.com/api/v3" },
    v3: { apiId: "test", apiKey: "test" }, tokenProvider: { getToken: async () => "test-token" }, observer: createCloudShareNoopRequestObserver(),
    http: { send: async request => { requests.push(request); return { status: 204, body: "" }; } },
  });
  await createCloudShareEnvironmentController(client).archiveEnvironment("EN-retained");
  const { createCloudShareSalesEnvironmentModule } = await import("./environment-observation");
  await createCloudShareSalesEnvironmentModule(client).extendById("EN-retained");
  expect(requests.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
    { method: "PUT", url: "https://use.cloudshare.com/api/v3/envs/actions/archive?envId=EN-retained", body: undefined },
    { method: "PUT", url: "https://use.cloudshare.com/api/v3/envs/actions/extend?envId=EN-retained", body: undefined },
  ]);
});
