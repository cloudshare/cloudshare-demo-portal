import { describe, expect, it } from "vitest";
import { createCloudShareClient, createCloudShareNoopRequestObserver } from "./client";
import type { HttpRequest } from "./http";
import { createCloudShareExamAuthoringSource, createCloudShareSalesItemResourceSource, createCloudShareResourceLister } from "./resources";

function recordingClient(pages: unknown[], statuses: number[] = []) {
  const requests: HttpRequest[] = [];
  const client = createCloudShareClient({
    endpoints: { v4BaseUrl: "https://api.accelerate.cloudshare.com/v4", v3BaseUrl: "https://use.cloudshare.com/api/v3" },
    v3: { apiId: "test-id", apiKey: "test-key" }, tokenProvider: { getToken: async () => "opaque-test-token" },
    observer: createCloudShareNoopRequestObserver(),
    http: { send: async (request) => { requests.push(request); return { status: statuses.shift() ?? 200, body: JSON.stringify(pages.shift()) }; } },
  });
  return { client, requests };
}

describe("v4 resource discovery", () => {
  it("returns every visible Project and retains each original page exchange", async () => {
    const first = { count: 3, items: [{ id: "PR-one", name: "One" }, { id: "PR-two", name: "Two" }], token: "protected-first" };
    const second = { count: 3, items: [{ id: "PR-three", name: "Three" }], secret: "protected-second" };
    const { client, requests } = recordingClient([first, second]);
    const source = createCloudShareSalesItemResourceSource(client);
    const result = await source.readProjects();
    expect(result.data).toEqual([...first.items, ...second.items]);
    expect(requests.map((request) => request.url)).toEqual([
      "https://api.accelerate.cloudshare.com/v4/projects?Count=true&Offset=0&Limit=100",
      "https://api.accelerate.cloudshare.com/v4/projects?Count=true&Offset=2&Limit=100",
    ]);
    expect(result).toMatchObject({ reads: [{ response: { body: first } }, { response: { body: second } }] });
  });
});
  it.each([
    { count: 2, items: [] },
    { count: 0, items: [{ id: "PR-two", name: "Two" }] },
    { count: 2, items: [{ id: "PR-one", name: "Repeated" }] },
    { count: null, items: [] },
    { count: 2 },
  ])("rejects incomplete or inconsistent pages without returning a partial list: %j", async (badPage) => {
    const first = { count: 2, items: [{ id: "PR-one", name: "One" }] };
    const { client, requests } = recordingClient([first, badPage]);
    await expect(createCloudShareSalesItemResourceSource(client).readProjects()).rejects.toMatchObject({
      completedReads: [{ response: { body: first } }],
      cause: { name: "CloudShareResponseError", context: { responseBody: badPage } },
    });
    expect(requests).toHaveLength(2);
  });
  it("uses all active Policy summaries then exact detail runtime/storage minutes for Exam and Sales", async () => {
    const list = { count: 1, items: [{ id: "PO-one", projectId: "PR-one", name: "Selected", allowEnvironmentCreation: true }] };
    const detail = { id: "PO-one", projectId: "PR-one", name: "Selected", runtimeMinutes: 45, storageMinutes: 2880, token: "protected-policy" };
    const { client, requests } = recordingClient([list, detail]);
    const result = await createCloudShareSalesItemResourceSource(client).readProjectPolicies("PR-one");
    expect(result.policies).toMatchObject([{ id: "PO-one", name: "Selected", runtimeLeaseMinutes: 45, storageLeaseMinutes: 2880 }]);
    expect(requests.map((request) => request.url)).toEqual([
      "https://api.accelerate.cloudshare.com/v4/projects/PR-one/policies?Count=true",
      "https://api.accelerate.cloudshare.com/v4/projects/PR-one/policies/PO-one",
    ]);
    expect(result.reads).toMatchObject([{ response: { body: list } }, { response: { body: detail } }]);
  });
  it.each([
    { id: "PO-other", projectId: "PR-one", runtimeMinutes: 45, storageMinutes: 2880 },
    { id: "PO-one", projectId: "PR-other", runtimeMinutes: 45, storageMinutes: 2880 },
  ])("rejects a Policy detail with changed identity: %j", async (fields) => {
    const list = { count: 1, items: [{ id: "PO-one", projectId: "PR-one", name: "Selected" }] };
    const detail = { name: "Selected", ...fields };
    const { client } = recordingClient([list, detail]);
    await expect(createCloudShareSalesItemResourceSource(client).readProjectPolicies("PR-one")).rejects.toMatchObject({
      completedReads: [{ response: { body: list } }], cause: { name: "CloudShareResponseError", context: { responseBody: detail } },
    });
  });
  it.each([
    { count: 2, items: [{ id: "PO-one", projectId: "PR-one", name: "Selected" }] },
    { count: 1, items: [{ id: "PO-one", projectId: "PR-other", name: "Selected" }] },
  ])("rejects incomplete or wrong-Project Policy lists: %j", async (list) => {
    const { client, requests } = recordingClient([{ count: 1, items: [{ id: "PR-one", name: "Project" }] }, list]);
    await expect(createCloudShareResourceLister(client).listPolicies()).rejects.toMatchObject({
      name: "CloudShareResponseError",
      context: { path: "/v4/projects/PR-one/policies", responseBody: list },
    });
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/v4/projects", "/v4/projects/PR-one/policies",
    ]);
    const direct = recordingClient([list]);
    await expect(createCloudShareExamAuthoringSource(direct.client).listProjectPolicies("PR-one")).rejects.toMatchObject({ name: "CloudShareResponseError", context: { responseBody: list } });
  });

  it.each(["exam", "sync"] as const)("%s traverses beyond 100 Projects and records each page before returning", async (kind) => {
    const first = { count: 101, items: Array.from({ length: 100 }, (_, index) => ({ id: `PR-${index}`, name: `Project ${index}` })) };
    const last = { count: 101, items: [{ id: "PR-last", name: "Last" }] };
    const { client, requests } = recordingClient([first, last]);
    const observed: unknown[] = [];
    const options = { onReadSuccess: async (read: { response: unknown }) => { observed.push(read.response); } };
    const source = kind === "exam" ? createCloudShareExamAuthoringSource(client, options) : createCloudShareResourceLister(client, options);
    const projects = await source.listProjects();
    expect(projects).toHaveLength(101);
    expect(projects[100]).toEqual({ id: "PR-last", name: "Last" });
    expect(requests[1]!.url).toContain("Offset=100&Limit=100");
    expect(observed).toMatchObject([{ body: first }, { body: last }]);
    if (kind === "sync") { await source.listProjects(); expect(requests).toHaveLength(2); }
  });

  it("keeps empty permission responses empty and performs no Policy detail requests", async () => {
    const { client, requests } = recordingClient([{ count: 0, items: [] }, { count: 0, items: [] }]);
    expect(await createCloudShareExamAuthoringSource(client).listProjects()).toEqual([]);
    expect(await createCloudShareExamAuthoringSource(client).listProjectPolicies("PR-one")).toEqual([]);
    expect(requests).toHaveLength(2);
  });

  it.each([
    [400, { projectId: ["Id has incorrect format"], token: "protected-error" }],
    [401, { error: "Unauthorized", errorDescription: "protected-legacy" }],
    [403, ""],
    [404, ""],
  ])("retains %s failure evidence and never falls back to v3", async (status, body) => {
    const { client, requests } = recordingClient([body], [status as number]);
    await expect(createCloudShareExamAuthoringSource(client).listProjectPolicies("PR-one")).rejects.toMatchObject({
      name: "CloudShareRequestError", status, context: { responseBody: body, requestHeaders: { authorization: "[REDACTED]" } },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toContain("/v4/projects/PR-one/policies");
  });

  it("resource sync preserves failed Project cache and successful page evidence", async () => {
    const first = { count: 2, items: [{ id: "PR-one", name: "One" }] };
    const failure = { "": ["protected-denied"] };
    const { client, requests } = recordingClient([first, failure], [200, 403]);
    const observed: unknown[] = [];
    const source = createCloudShareResourceLister(client, { onReadSuccess: async (read) => { observed.push(read.response); } });
    await expect(source.listProjects()).rejects.toMatchObject({ status: 403 });
    await expect(source.listBlueprints()).rejects.toMatchObject({ status: 403 });
    expect(requests).toHaveLength(2);
    expect(observed).toEqual([{ status: 200, body: first }]);
  });
  it("Sync Resources uses v4 Policy lists and passes the exact v4 Project id to retained v3 Blueprint reads", async () => {
    const project = { id: "PR-exact", name: "Exact Project" };
    const { client, requests } = recordingClient([
      { count: 1, items: [project] },
      [{ id: "BP-one", name: "Blueprint" }],
      { count: 1, items: [{ id: "PO-one", projectId: "PR-exact", name: "Policy" }] },
    ]);
    const source = createCloudShareResourceLister(client);
    expect(await source.listBlueprints()).toEqual([{ id: "BP-one", name: "Blueprint" }]);
    expect(await source.listPolicies()).toEqual([{ id: "PO-one", name: "Policy" }]);
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/v4/projects", "/api/v3/projects/PR-exact/blueprints", "/v4/projects/PR-exact/policies",
    ]);
  });
