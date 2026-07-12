import { describe, expect, it } from "vitest";
import { createFetchHttpClient, HttpTransportError } from "./http";

describe("createFetchHttpClient", () => {
  it("captures socket metadata when the live transport rejects before a response", async () => {
    await expect(createFetchHttpClient().send({ method: "GET", url: "http://127.0.0.1:1/unreachable" })).rejects.toMatchObject({
      name: "HttpTransportError",
      network: expect.objectContaining({ transport: "tcp" }),
    } satisfies Partial<HttpTransportError>);
  });
});
