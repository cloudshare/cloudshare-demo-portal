import { describe, expect, it, vi } from "vitest";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRecord,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import { createDiagnosticRecorder, type DiagnosticRecorder } from "@/domain/diagnostic-log";
import { CloudShareRateLimitError, CloudShareRequestError } from "@/integrations/cloudshare";
import type { CloudShareClient } from "@/integrations/cloudshare";
import type { CloudShareExamAuthoringSource } from "@/integrations/cloudshare/resources";
import type { Logger } from "@/observability/logger";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import { createInMemoryExamAuthoringCacheRepository } from "@/persistence/exam-authoring-cache-repository";
import {
  getBlueprintDetailRuntime,
  getExamAuthoringBootstrapRuntime,
  getProjectResourcesRuntime,
} from "./admin-exam-authoring-runtime";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeConnectionRecord(): CloudShareConnectionRecord {
  return {
    customerId: "customer-1",
    apiId: "api-id",
    apiKey: "api-key",
    webhookSecret: "whsec",
    webhookPathToken: "whk-customer-1",
    connectedAt: new Date("2026-06-14T11:00:00.000Z"),
    verifiedAt: new Date("2026-06-14T11:05:00.000Z"),
  };
}

function makeConnections(
  connection: CloudShareConnectionRecord | null = makeConnectionRecord(),
): CloudShareConnectionRepository {
  return {
    save: vi.fn(),
    findByCustomerId: vi.fn().mockResolvedValue(connection),
    findByWebhookPathToken: vi.fn().mockResolvedValue(connection),
    markVerified: vi.fn(),
  };
}

function makeAuthoringSource(
  overrides: Partial<CloudShareExamAuthoringSource> = {},
): CloudShareExamAuthoringSource {
  return {
    listProjects: vi.fn().mockResolvedValue([{ id: "project-1", name: "Helios CX Project" }]),
    listRegions: vi.fn().mockResolvedValue([
      { id: "region-1", name: "eu-west", friendlyName: "EU West" },
      { id: "region-2", name: "us-east", friendlyName: "US East" },
    ]),
    listProjectBlueprints: vi.fn().mockResolvedValue([
      {
        id: "bp-1",
        name: "Helios Exam Blueprint",
        description: "Blueprint-backed description",
      },
    ]),
    listProjectPolicies: vi.fn().mockResolvedValue([
      { id: "policy-1", name: "Standard Exam Policy", runtimeLeaseMinutes: 240 },
    ]),
    getBlueprintDetail: vi.fn().mockResolvedValue({
      id: "bp-1",
      name: "Helios Exam Blueprint",
      description: "Blueprint-backed description",
      defaultSnapshotId: "snap-1",
      snapshots: [
        {
          id: "snap-1",
          name: "Default Snapshot",
          isDefault: true,
          regionIds: ["region-1"],
        },
      ],
    }),
    ...overrides,
  };
}

function makeCloudShareFactory(source: CloudShareExamAuthoringSource): CloudShareClientFactory {
  return {
    forConnection: vi.fn().mockReturnValue(source),
  } as unknown as CloudShareClientFactory;
}

function makeDiagnostics(): {
  recorder: DiagnosticRecorder;
  repository: ReturnType<typeof createInMemoryDiagnosticLogRepository>;
} {
  const repository = createInMemoryDiagnosticLogRepository();
  const recorder = createDiagnosticRecorder({
    repository,
    secrets: ["api-id", "api-key", "whsec", "sig-secret"],
  });
  return { recorder, repository };
}

describe("admin Exam authoring resource runtime", () => {
  it("persists complete provider exchanges when it builds the authoring adapter", async () => {
    const client = {
      requestV3Detailed: vi.fn(async (spec: { path: string }) => {
        const data = spec.path === "/projects"
          ? [{ id: "project-1", name: "Helios CX Project" }]
          : [{ id: "region-1", name: "eu-west", friendlyName: "EU West" }];
        return {
          data,
          request: { method: "GET", path: spec.path, query: { tenant: "helios" } },
          response: {
            status: 200,
            headers: { "x-cloudshare-request": `request-${spec.path}` },
            body: data.map((item) => ({ ...item, providerField: "retained" })),
          },
        };
      }),
    } as unknown as CloudShareClient;
    const diagnostics = makeDiagnostics();

    const result = await getExamAuthoringBootstrapRuntime(
      {
        connections: makeConnections(),
        cloudshare: { forConnection: vi.fn().mockReturnValue(client) } as unknown as CloudShareClientFactory,
        cache: createInMemoryExamAuthoringCacheRepository(),
        diagnostics: diagnostics.recorder,
        logger: makeLogger(),
      },
      { customerId: "customer-1", refresh: true },
    );

    expect(result.status).toBe(200);
    await expect(diagnostics.repository.query({ customerId: "customer-1" })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        request: { method: "GET", path: "/projects", query: { tenant: "helios" } },
        response: expect.objectContaining({
          body: [{ id: "project-1", name: "Helios CX Project", providerField: "retained" }],
        }),
      }),
      expect.objectContaining({
        request: { method: "GET", path: "/regions", query: { tenant: "helios" } },
        response: expect.objectContaining({
          body: [{ id: "region-1", name: "eu-west", friendlyName: "EU West", providerField: "retained" }],
        }),
      }),
    ]));
  });

  it("reads Projects and Regions, records diagnostics, and serves the cached bootstrap", async () => {
    const source = makeAuthoringSource();
    const cache = createInMemoryExamAuthoringCacheRepository();
    const diagnostics = makeDiagnostics();

    const result = await getExamAuthoringBootstrapRuntime(
      {
        connections: makeConnections(),
        cloudshare: makeCloudShareFactory(source),
        cache,
        diagnostics: diagnostics.recorder,
        logger: makeLogger(),
      },
      { customerId: "customer-1", refresh: false },
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      source: "live",
      projects: [{ id: "project-1", name: "Helios CX Project" }],
      regions: [
        { id: "region-1", name: "eu-west", friendlyName: "EU West" },
        { id: "region-2", name: "us-east", friendlyName: "US East" },
      ],
    });

    const cached = await getExamAuthoringBootstrapRuntime(
      {
        connections: makeConnections(),
        cloudshare: makeCloudShareFactory(source),
        cache,
        logger: makeLogger(),
      },
      { customerId: "customer-1", refresh: false },
    );

    expect(cached.body).toMatchObject({ source: "cache" });
    expect(source.listProjects).toHaveBeenCalledTimes(1);
    expect(source.listRegions).toHaveBeenCalledTimes(1);
    await expect(diagnostics.repository.query({ customerId: "customer-1" })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "admin-exams",
          operation: "cloudshare.resource_sync.projects.read",
          outcome: "success",
          request: { method: "GET", path: "/projects" },
          response: { itemCount: 1, resourceIds: ["project-1"] },
        }),
        expect.objectContaining({
          source: "admin-exams",
          operation: "cloudshare.resource_sync.regions.read",
          outcome: "success",
          request: { method: "GET", path: "/regions" },
          response: { itemCount: 2, resourceIds: ["region-1", "region-2"] },
        }),
      ]),
    );
  });

  it("uses the initiating Sales source label while preserving per-read operations", async () => {
    const diagnostics = makeDiagnostics();
    await getExamAuthoringBootstrapRuntime({ connections: makeConnections(), cloudshare: makeCloudShareFactory(makeAuthoringSource()), cache: createInMemoryExamAuthoringCacheRepository(), diagnostics: diagnostics.recorder, logger: makeLogger(), diagnosticSource: "sales-items" }, { customerId: "customer-1", refresh: true });
    await expect(diagnostics.repository.query({ customerId: "customer-1" })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "sales-items", operation: "cloudshare.resource_sync.projects.read" }),
      expect.objectContaining({ source: "sales-items", operation: "cloudshare.resource_sync.regions.read" }),
    ]));
  });

  it("returns support diagnostics when a Project-scoped resource read fails", async () => {
    const source = makeAuthoringSource({
      listProjectPolicies: vi.fn().mockRejectedValue(
        new CloudShareRequestError("403 forbidden", 403, {
          method: "GET",
          requestHeaders: { authorization: "cs_sha1 [REDACTED]" },
          responseBody: JSON.stringify({
            error: "forbidden",
            signature: "sig-secret",
          }),
        }),
      ),
    });
    const diagnostics = makeDiagnostics();

    const result = await getProjectResourcesRuntime(
      {
        connections: makeConnections(),
        cloudshare: makeCloudShareFactory(source),
        cache: createInMemoryExamAuthoringCacheRepository(),
        diagnostics: diagnostics.recorder,
        logger: makeLogger(),
        now: () => new Date("2026-06-25T12:00:00.000Z"),
        newCorrelationId: () => "corr-1",
      },
      { customerId: "customer-1", projectId: "project-1", refresh: true },
    );

    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({
      error: "CloudShare resource request failed.",
      correlationId: "corr-1",
      occurredAt: "2026-06-25T12:00:00.000Z",
      diagnostic: {
        operation: "cloudshare.resource_sync.policies.read",
        integrationSurface: "cloudshare.v3.projects.policies",
        method: "GET",
        path: "/projects/project-1/policies",
        failureMode: "http_status",
        responseStatus: 403,
      },
    });
    await expect(
      diagnostics.repository.query({
        customerId: "customer-1",
        operation: "cloudshare.resource_sync.policies.read",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        source: "admin-exams",
        operation: "cloudshare.resource_sync.policies.read",
        outcome: "failure",
        externalIds: { resourceType: "policy", projectId: "project-1" },
        request: {
          method: "GET",
          path: "/projects/project-1/policies",
          headers: { authorization: "[REDACTED]" },
        },
        response: {
          status: 403,
          body: {
            error: "forbidden",
          signature: "sig-secret",
          },
        },
      }),
    ]);
  });

  it("returns 429 and rate-limit diagnostics when a Project-scoped resource read is throttled", async () => {
    const source = makeAuthoringSource({
      listProjectPolicies: vi.fn().mockRejectedValue(
        new CloudShareRateLimitError("too many requests", 429, "rate_limit", {
          method: "GET",
          requestHeaders: { authorization: "cs_sha1 [REDACTED]" },
          responseHeaders: { "retry-after": "30" },
          retryAfterSeconds: 30,
        }),
      ),
    });
    const diagnostics = makeDiagnostics();

    const result = await getProjectResourcesRuntime(
      {
        connections: makeConnections(),
        cloudshare: makeCloudShareFactory(source),
        cache: createInMemoryExamAuthoringCacheRepository(),
        diagnostics: diagnostics.recorder,
        logger: makeLogger(),
        now: () => new Date("2026-06-25T12:00:00.000Z"),
        newCorrelationId: () => "corr-rate-limit",
      },
      { customerId: "customer-1", projectId: "project-1", refresh: true },
    );

    expect(result.status).toBe(429);
    expect(result.body).toMatchObject({
      error: "CloudShare is returning a 429 error for the current request. This is likely CloudShare rate limiting or abuse protection blocking the request. Check whether this public IP needs CloudShare allow-list or abuse-list review before retrying by contacting support@cloudshare.com.",
      correlationId: "corr-rate-limit",
      diagnostic: {
        operation: "cloudshare.resource_sync.policies.read",
        failureMode: "rate_limit",
        responseStatus: 429,
      },
    });
    await expect(
      diagnostics.repository.query({
        customerId: "customer-1",
        operation: "cloudshare.resource_sync.policies.read",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        outcome: "failure",
        details: expect.objectContaining({
          failureMode: "rate_limit",
        }),
        response: {
          status: 429,
          headers: { "retry-after": "30" },
        },
      }),
    ]);
  });

  it("strips diagnostic-only Blueprint detail metadata from the authoring response", async () => {
    const source = makeAuthoringSource({
      getBlueprintDetail: vi.fn().mockResolvedValue({
        id: "bp-1",
        name: "Helios Exam Blueprint",
        description: "Blueprint-backed description",
        defaultSnapshotId: "snap-1",
        diagnosticSummary: { blueprintId: "bp-1", sensitiveShape: "support-only" },
        diagnosticResponse: { status: 200, body: { sensitiveShape: "support-only" } },
        snapshots: [
          {
            id: "snap-1",
            name: "Default Snapshot",
            isDefault: true,
            regionIds: ["region-1"],
          },
        ],
      }),
    });

    const result = await getBlueprintDetailRuntime(
      {
        connections: makeConnections(),
        cloudshare: makeCloudShareFactory(source),
        cache: createInMemoryExamAuthoringCacheRepository(),
        logger: makeLogger(),
      },
      { customerId: "customer-1", projectId: "project-1", blueprintId: "bp-1", refresh: true },
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      source: "live",
      projectId: "project-1",
      blueprint: {
        id: "bp-1",
        name: "Helios Exam Blueprint",
        description: "Blueprint-backed description",
        defaultSnapshotId: "snap-1",
        snapshots: [
          {
            id: "snap-1",
            name: "Default Snapshot",
            isDefault: true,
            regionIds: ["region-1"],
          },
        ],
      },
    });
    expect(JSON.stringify(result.body)).not.toContain("sensitiveShape");
  });
});
