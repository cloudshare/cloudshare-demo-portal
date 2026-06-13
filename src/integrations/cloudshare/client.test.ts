import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createCloudShareClient } from "./client";
import { createFixtureHttpClient, loadFixturesFromDir } from "./fixtures";
import {
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
} from "./errors";
import type { HttpClient, HttpRequest, HttpResponse } from "./http";
import type { V4TokenProvider } from "./v4-auth";

const endpoints = {
  v4BaseUrl: "https://api.accelerate.cloudshare.com/v4",
  v3BaseUrl: "https://use.cloudshare.com/api/v3",
};

const stubTokenProvider: V4TokenProvider = { getToken: async () => "test-bearer" };

/** HttpClient that records the last request and returns a fixed response. */
function capturingHttp(response: HttpResponse): {
  http: HttpClient;
  last: () => HttpRequest | undefined;
} {
  let last: HttpRequest | undefined;
  return {
    http: {
      async send(request) {
        last = request;
        return response;
      },
    },
    last: () => last,
  };
}

const ok = (body: unknown): HttpResponse => ({ status: 200, body: JSON.stringify(body) });
const projectsSchema = z.array(z.object({ id: z.string(), name: z.string() }));

function clientWith(http: HttpClient) {
  return createCloudShareClient({
    http,
    endpoints,
    tokenProvider: stubTokenProvider,
    v3: { apiId: "api-id", apiKey: "api-key" },
    newToken: () => "tok-fixed",
    now: () => 1_700_000_000_000,
  });
}

describe("createCloudShareClient — v4", () => {
  it("returns schema-validated data and sends a Bearer token", async () => {
    const { http, last } = capturingHttp(ok([{ id: "p1", name: "Proj" }]));
    const client = clientWith(http);

    const data = await client.requestV4({
      method: "GET",
      path: "/projects",
      schema: projectsSchema,
    });

    expect(data).toEqual([{ id: "p1", name: "Proj" }]);
    expect(last()?.url).toBe("https://api.accelerate.cloudshare.com/v4/projects");
    expect(last()?.headers?.authorization).toBe("Bearer test-bearer");
  });
});

describe("createCloudShareClient — v3", () => {
  it("returns validated data and appends cs_sha1 auth params to the query", async () => {
    const { http, last } = capturingHttp(ok([{ id: "r1", name: "EU" }]));
    const client = clientWith(http);

    const data = await client.requestV3({
      method: "GET",
      path: "/regions",
      schema: projectsSchema,
    });

    expect(data).toEqual([{ id: "r1", name: "EU" }]);
    const url = new URL(last()!.url);
    expect(url.pathname).toBe("/api/v3/regions");
    expect(url.searchParams.get("UserApiId")).toBe("api-id");
    expect(url.searchParams.get("Timestamp")).toBe("1700000000");
    expect(url.searchParams.get("Token")).toBe("tok-fixed");
    expect(url.searchParams.get("HMAC")).toMatch(/^[0-9a-f]{40}$/);
  });

  it("supports signed text responses for the v3 ping endpoint", async () => {
    const { http, last } = capturingHttp({ status: 200, body: "pong" });
    const client = clientWith(http);

    const body = await client.requestV3Text({
      method: "GET",
      path: "/ping",
    });

    expect(body).toBe("pong");
    const url = new URL(last()!.url);
    expect(url.pathname).toBe("/api/v3/ping");
    expect(url.searchParams.get("UserApiId")).toBe("api-id");
  });
});

describe("createCloudShareClient — error mapping", () => {
  it("raises CloudShareRequestError on a non-2xx status", async () => {
    const { http } = capturingHttp({ status: 500, body: "boom" });
    const client = clientWith(http);
    await expect(
      client.requestV4({ method: "GET", path: "/projects", schema: projectsSchema }),
    ).rejects.toBeInstanceOf(CloudShareRequestError);
  });

  it("raises CloudShareResponseError when the body fails schema validation", async () => {
    const { http } = capturingHttp(ok([{ id: 123 }]));
    const client = clientWith(http);
    await expect(
      client.requestV4({ method: "GET", path: "/projects", schema: projectsSchema }),
    ).rejects.toBeInstanceOf(CloudShareResponseError);
  });

  it("maps a transport failure (http.send throws) to CloudShareTransportError", async () => {
    const http: HttpClient = {
      async send() {
        throw new Error("ECONNREFUSED");
      },
    };
    const client = clientWith(http);
    await expect(
      client.requestV4({ method: "GET", path: "/projects", schema: projectsSchema }),
    ).rejects.toBeInstanceOf(CloudShareTransportError);
  });

  it("raises CloudShareResponseError on a non-JSON body", async () => {
    const { http } = capturingHttp({ status: 200, body: "<html>nope" });
    const client = clientWith(http);
    await expect(
      client.requestV4({ method: "GET", path: "/projects", schema: projectsSchema }),
    ).rejects.toBeInstanceOf(CloudShareResponseError);
  });
});

describe("createCloudShareClient — fixture replay (no live calls)", () => {
  const fixturesDir = fileURLToPath(new URL("./fixtures", import.meta.url));
  const fixtureClient = clientWith(createFixtureHttpClient(loadFixturesFromDir(fixturesDir)));

  it("replays a recorded v4 response through the same adapter path", async () => {
    const projects = await fixtureClient.requestV4({
      method: "GET",
      path: "/projects",
      schema: projectsSchema,
    });
    expect(projects).toHaveLength(2);
    expect(projects[0]).toEqual({ id: "p-demo-1", name: "Genesys Certification" });
  });

  it("replays a recorded v3 response through the same adapter path", async () => {
    const regions = await fixtureClient.requestV3({
      method: "GET",
      path: "/regions",
      schema: projectsSchema,
    });
    expect(regions).toHaveLength(2);
    expect(regions[1]).toEqual({ id: "r-us-east", name: "US East" });
  });
});
