import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { createFetchHttpClient, HttpTransportError } from "./http";

describe("createFetchHttpClient", () => {
  it("captures socket metadata when the live transport rejects before a response", async () => {
    await expect(createFetchHttpClient().send({ method: "GET", url: "http://127.0.0.1:1/unreachable" })).rejects.toMatchObject({
      name: "HttpTransportError",
      network: expect.objectContaining({ transport: "tcp" }),
    } satisfies Partial<HttpTransportError>);
  });

  it("destroys a real slow socket at timeout and preserves provider-timeout evidence", async () => {
    const server = createServer(() => { /* deliberately never respond */ });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected TCP listener");
    try {
      const started = Date.now();
      await expect(createFetchHttpClient().send({ method: "GET", url: `http://127.0.0.1:${address.port}/slow`, timeoutMs: 25 })).rejects.toMatchObject({ name: "HttpTransportError", cause: expect.objectContaining({ code: "ETIMEDOUT" }) });
      expect(Date.now() - started).toBeLessThan(500);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
